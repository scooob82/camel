package com.camelstudio.runner;

import java.util.List;
import java.util.Map;

/** Wire protocol — mirrors src/core/runner.ts in the frontend. */
public final class Dto {

    private Dto() {
    }

    public record RunInput(String body, Map<String, String> headers) {
    }

    public record RunRequest(String yaml, String start, RunInput input, Integer timeoutMs) {
    }

    public record TraceEvent(int seq, String nodeId, String routeId, String label, long atMs, long tookMs, String body,
            Map<String, String> headers, Map<String, String> properties, String exception) {
    }

    public record MockResult(String uri, int count, List<String> bodies) {
    }

    public record Output(String body, Map<String, String> headers) {
    }

    public record RunResult(boolean ok, long durationMs, List<TraceEvent> trace, Output output, String error, List<MockResult> mocks,
            List<String> logs) {
    }

    public record TransformRequest(String kind, String source, String input, Map<String, String> params, Boolean trace) {
    }

    public record TraceEntry(int line, Integer column, String instruction, int depth, Long tookMs) {
    }

    public record TransformError(String message, Integer line) {
    }

    public record TransformResult(boolean ok, String output, List<String> messages, long durationMs, List<TraceEntry> trace, TransformError error) {
    }
}
