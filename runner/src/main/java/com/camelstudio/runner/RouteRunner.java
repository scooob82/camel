package com.camelstudio.runner;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import org.apache.camel.Exchange;
import org.apache.camel.ExchangePattern;
import org.apache.camel.component.mock.MockEndpoint;
import org.apache.camel.impl.DefaultCamelContext;
import org.apache.camel.spi.PropertiesSource;
import org.apache.camel.support.DefaultExchange;
import org.apache.camel.support.PluginHelper;
import org.apache.camel.support.ResourceHelper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/** Runs one request in a fresh, isolated CamelContext and returns the recorded trace. */
@Service
public class RouteRunner {

    private final int maxTimeoutMs;
    private final int maxBodyBytes;
    private final int maxTraceEvents;
    private final Semaphore slots;
    private final ExecutorService executor = Executors.newCachedThreadPool();

    public RouteRunner(@Value("${runner.max-timeout-ms}") int maxTimeoutMs, @Value("${runner.max-body-bytes}") int maxBodyBytes,
            @Value("${runner.max-trace-events}") int maxTraceEvents, @Value("${runner.max-concurrent-runs}") int maxConcurrent) {
        this.maxTimeoutMs = maxTimeoutMs;
        this.maxBodyBytes = maxBodyBytes;
        this.maxTraceEvents = maxTraceEvents;
        this.slots = new Semaphore(maxConcurrent);
    }

    public Dto.RunResult run(Dto.RunRequest req) {
        long t0 = System.nanoTime();
        List<Dto.TraceEvent> trace = Collections.synchronizedList(new ArrayList<>());
        List<String> logs = Collections.synchronizedList(new ArrayList<>());
        String body = req.input() != null && req.input().body() != null ? req.input().body() : "";
        if (body.length() > maxBodyBytes) {
            return failure(t0, trace, logs, "Input body is too large");
        }
        try {
            Sandbox.check(req.yaml());
        } catch (IllegalArgumentException e) {
            return failure(t0, trace, logs, e.getMessage());
        }
        if (!slots.tryAcquire()) {
            return failure(t0, trace, logs, "The sandbox is busy — try again in a moment");
        }
        DefaultCamelContext ctx = new DefaultCamelContext();
        try {
            ctx.setName("sandbox");
            ctx.getCamelContextExtension().addInterceptStrategy(new TracingStrategy(trace, t0, maxTraceEvents, 20_000));
            ctx.getCamelContextExtension().addLogListener((exchange, logger, message) -> {
                if (logs.size() < 200) {
                    logs.add(message);
                }
                return message;
            });
            // {{placeholders}} resolve to harmless values inside the sandbox
            ctx.getPropertiesComponent().addPropertiesSource(new PlaceholderSource());
            PluginHelper.getRoutesLoader(ctx).loadRoutes(ResourceHelper.fromString("memory:routes.camel.yaml", req.yaml()));
            ctx.start();

            Exchange in = new DefaultExchange(ctx, ExchangePattern.InOut);
            in.getMessage().setBody(body);
            if (req.input() != null && req.input().headers() != null) {
                req.input().headers().forEach((k, v) -> in.getMessage().setHeader(k, v));
            }
            String start = Optional.ofNullable(req.start()).orElse("direct:cas-start");
            int timeout = Math.max(500, Math.min(Optional.ofNullable(req.timeoutMs()).orElse(5000), maxTimeoutMs));
            Future<Exchange> f = executor.submit(() -> ctx.createProducerTemplate().send(start, in));
            Exchange out;
            try {
                out = f.get(timeout, TimeUnit.MILLISECONDS);
            } catch (TimeoutException e) {
                f.cancel(true);
                return new Dto.RunResult(false, ms(t0), copy(trace), null, "Timed out after " + timeout + " ms", mocks(ctx), copy(logs));
            }
            Exception ex = out.getException();
            Dto.Output output = new Dto.Output(Optional.ofNullable(out.getMessage().getBody(String.class)).orElse(""), headers(out.getMessage().getHeaders()));
            return new Dto.RunResult(ex == null, ms(t0), copy(trace), output, ex == null ? null : ex.getClass().getName() + ": " + ex.getMessage(),
                    mocks(ctx), copy(logs));
        } catch (Exception e) {
            Throwable root = e;
            while (root.getCause() != null && root.getCause() != root) {
                root = root.getCause();
            }
            return failure(t0, trace, logs, "Could not run the routes: " + root.getMessage());
        } finally {
            try {
                ctx.stop();
            } catch (Exception ignore) {
                // best effort
            }
            slots.release();
        }
    }

    private static List<Dto.MockResult> mocks(DefaultCamelContext ctx) {
        List<Dto.MockResult> out = new ArrayList<>();
        for (var ep : ctx.getEndpoints()) {
            if (ep instanceof MockEndpoint m) {
                List<String> bodies = m.getReceivedExchanges().stream().limit(20).map(x -> Optional.ofNullable(x.getMessage().getBody(String.class)).orElse("")).toList();
                out.add(new Dto.MockResult(m.getEndpointUri().replaceFirst("^mock://", "mock:"), m.getReceivedCounter(), bodies));
            }
        }
        return out;
    }

    private static Map<String, String> headers(Map<String, Object> h) {
        Map<String, String> out = new java.util.LinkedHashMap<>();
        h.forEach((k, v) -> out.put(k, String.valueOf(v)));
        return out;
    }

    private static <T> List<T> copy(List<T> l) {
        synchronized (l) {
            return new ArrayList<>(l);
        }
    }

    private static long ms(long t0) {
        return (System.nanoTime() - t0) / 1_000_000;
    }

    private static Dto.RunResult failure(long t0, List<Dto.TraceEvent> trace, List<String> logs, String error) {
        return new Dto.RunResult(false, ms(t0), copy(trace), null, error, List.of(), copy(logs));
    }

    /** Resolves every {{placeholder}} to "sandbox-&lt;name&gt;" so routes load without real config. */
    static final class PlaceholderSource implements PropertiesSource {
        @Override
        public String getName() {
            return "sandbox";
        }

        @Override
        public String getProperty(String name) {
            return "sandbox-" + name;
        }

        @Override
        public String getProperty(String name, String defaultValue) {
            return defaultValue != null ? defaultValue : getProperty(name);
        }
    }
}
