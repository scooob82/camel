package com.camelstudio.runner;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import org.apache.camel.AsyncCallback;
import org.apache.camel.CamelContext;
import org.apache.camel.Exchange;
import org.apache.camel.NamedNode;
import org.apache.camel.Processor;
import org.apache.camel.model.ProcessorDefinition;
import org.apache.camel.model.ProcessorDefinitionHelper;
import org.apache.camel.model.RouteDefinition;
import org.apache.camel.spi.InterceptStrategy;
import org.apache.camel.support.processor.DelegateAsyncProcessor;

/**
 * Records a snapshot of the message every time it enters a processor. Node ids are the
 * builder's model ids (the frontend emits them as "id:" in the YAML), so the UI can light up
 * the right node in the diagram.
 */
final class TracingStrategy implements InterceptStrategy {

    private final List<Dto.TraceEvent> trace;
    private final long startNanos;
    private final int maxEvents;
    private final int maxValueChars;
    private final AtomicInteger seq = new AtomicInteger();

    TracingStrategy(List<Dto.TraceEvent> trace, long startNanos, int maxEvents, int maxValueChars) {
        this.trace = trace;
        this.startNanos = startNanos;
        this.maxEvents = maxEvents;
        this.maxValueChars = maxValueChars;
    }

    @Override
    public Processor wrapProcessorInInterceptors(CamelContext context, NamedNode definition, Processor target, Processor nextTarget) {
        final String nodeId = definition.getId();
        final String label = definition.getLabel();
        String routeId = "";
        if (definition instanceof ProcessorDefinition<?> pd) {
            RouteDefinition route = ProcessorDefinitionHelper.getRoute(pd);
            if (route != null && route.getRouteId() != null) {
                routeId = route.getRouteId();
            }
        }
        final String rid = routeId;
        return new DelegateAsyncProcessor(target) {
            @Override
            public boolean process(Exchange exchange, AsyncCallback callback) {
                final long enter = System.nanoTime();
                final String body = text(exchange.getMessage().getBody(String.class));
                final Map<String, String> headers = strings(exchange.getMessage().getHeaders());
                final Map<String, String> props = strings(exchange.getProperties());
                return processor.process(exchange, doneSync -> {
                    if (seq.get() < maxEvents) {
                        Exception ex = exchange.getException();
                        trace.add(new Dto.TraceEvent(seq.getAndIncrement(), nodeId, rid, label, (enter - startNanos) / 1_000_000,
                                (System.nanoTime() - enter) / 1_000_000, body, headers, props,
                                ex != null ? ex.getClass().getName() + ": " + ex.getMessage() : null));
                    }
                    callback.done(doneSync);
                });
            }
        };
    }

    private String text(Object o) {
        if (o == null) {
            return "";
        }
        String s = String.valueOf(o);
        return s.length() > maxValueChars ? s.substring(0, maxValueChars) + "…" : s;
    }

    private Map<String, String> strings(Map<String, Object> map) {
        Map<String, String> out = new LinkedHashMap<>();
        if (map == null) {
            return out;
        }
        int n = 0;
        for (var e : map.entrySet()) {
            if (n++ >= 100) {
                break;
            }
            out.put(e.getKey(), text(e.getValue()));
        }
        return out;
    }
}
