package com.camelstudio.runner;

import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.util.Map;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
public class RunnerController {

    private final RouteRunner runner;
    private final TransformService transforms;
    private final String token;

    public RunnerController(RouteRunner runner, TransformService transforms, @Value("${runner.token}") String token) {
        this.runner = runner;
        this.transforms = transforms;
        this.token = token;
        if (token == null || token.length() < 16) {
            throw new IllegalStateException("Set RUNNER_TOKEN (at least 16 characters) — the PHP API uses it to call the runner");
        }
    }

    private void auth(String sent) {
        if (sent == null || !MessageDigest.isEqual(sent.getBytes(StandardCharsets.UTF_8), token.getBytes(StandardCharsets.UTF_8))) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of("ok", true, "camel", org.apache.camel.impl.DefaultCamelContext.class.getPackage().getImplementationVersion() == null ? "4" : org.apache.camel.impl.DefaultCamelContext.class.getPackage().getImplementationVersion(), "saxon", net.sf.saxon.Version.getProductVersion());
    }

    @PostMapping("/run")
    public Dto.RunResult run(@RequestHeader(value = "X-Runner-Token", required = false) String sent, @RequestBody Dto.RunRequest req) {
        auth(sent);
        return runner.run(req);
    }

    @PostMapping("/transform")
    public Dto.TransformResult transform(@RequestHeader(value = "X-Runner-Token", required = false) String sent, @RequestBody Dto.TransformRequest req) {
        auth(sent);
        return transforms.transform(req);
    }
}
