package com.camelstudio.runner;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Sandbox service for the Studio: runs Camel routes with tracing (Run &amp; Debug) and
 * XSLT 3.0 / XQuery with Saxon (Transformation Lab). Called only by the PHP API.
 */
@SpringBootApplication
public class RunnerApplication {

    public static void main(String[] args) {
        SpringApplication.run(RunnerApplication.class, args);
    }
}
