package com.camelstudio.runner;

import java.util.List;
import java.util.regex.Pattern;

/**
 * First line of defence: reject routes that could touch the host. The second line is the
 * container (read-only FS, no egress network, CPU/memory/pid limits) — see runner/README.md.
 */
public final class Sandbox {

    private static final List<String> BLOCKED_SCHEMES = List.of("exec", "ssh", "scp", "docker", "kubernetes", "file", "ftp", "ftps", "sftp",
            "jdbc", "sql", "netty", "netty-http", "jetty", "undertow", "platform-http", "rest", "http", "https", "kafka", "jms", "amqp",
            "spring-rabbitmq", "paho-mqtt5", "smtp", "smtps", "imap", "imaps", "pop3", "aws2-s3", "aws2-sqs", "azure-storage-blob",
            "google-pubsub", "mongodb", "spring-redis", "cxf", "graphql", "quartz", "cron", "timer", "scheduler", "language", "class");

    private static final List<String> BLOCKED_LANGUAGES = List.of("groovy", "joor", "java", "jsh", "mvel", "ognl", "spel", "python", "js",
            "datasonnet");

    private static final Pattern URI = Pattern.compile("(?m)uri:\\s*[\"']?([a-z0-9+.-]+):");
    private static final Pattern LANGUAGE = Pattern.compile("(?m)^\\s*-?\\s*(" + String.join("|", BLOCKED_LANGUAGES) + "):");

    private Sandbox() {
    }

    /** @throws IllegalArgumentException when the YAML uses something the sandbox does not allow */
    public static void check(String yaml) {
        if (yaml == null || yaml.isBlank()) {
            throw new IllegalArgumentException("No routes to run");
        }
        var m = URI.matcher(yaml);
        while (m.find()) {
            String scheme = m.group(1);
            if (BLOCKED_SCHEMES.contains(scheme)) {
                throw new IllegalArgumentException("Component \"" + scheme + "\" is not allowed in the sandbox — mock it");
            }
        }
        var l = LANGUAGE.matcher(yaml);
        if (l.find()) {
            throw new IllegalArgumentException("Language \"" + l.group(1) + "\" is not allowed in the sandbox");
        }
        if (yaml.contains("- beans:") || yaml.contains("#class:") || yaml.contains("#type:")) {
            throw new IllegalArgumentException("Creating beans is not allowed in the sandbox");
        }
    }
}
