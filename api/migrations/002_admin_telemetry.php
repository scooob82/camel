<?php
// Admin, privacy-friendly telemetry (no cookies, no IPs stored) and per-user settings.
return [
    'CREATE TABLE page_views (
        day CHAR(10) NOT NULL,
        path VARCHAR(120) NOT NULL,
        views INT NOT NULL DEFAULT 0,
        PRIMARY KEY (day, path)
    ) {TABLE_OPTIONS}',

    'CREATE TABLE client_errors (
        id {ID} PRIMARY KEY,
        created_at BIGINT NOT NULL,
        message VARCHAR(500) NOT NULL,
        stack TEXT NULL,
        url VARCHAR(300) NULL,
        user_id {ID} NULL,
        user_agent VARCHAR(300) NULL
    ) {TABLE_OPTIONS}',
    'CREATE INDEX idx_client_errors_created ON client_errors (created_at)',

    'CREATE TABLE user_settings (
        user_id {ID} PRIMARY KEY,
        snippets {LONGTEXT} NULL,
        updated_at BIGINT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) {TABLE_OPTIONS}',
];
