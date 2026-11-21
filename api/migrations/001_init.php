<?php
// Initial schema. Timestamps are epoch milliseconds (BIGINT) to match the frontend.
return [
    'CREATE TABLE users (
        id {ID} PRIMARY KEY,
        email VARCHAR(191) NOT NULL UNIQUE,
        name VARCHAR(80) NOT NULL DEFAULT \'\',
        password_hash VARCHAR(255) NOT NULL,
        plan VARCHAR(16) NOT NULL DEFAULT \'free\',
        role VARCHAR(16) NOT NULL DEFAULT \'user\',
        email_verified_at BIGINT NULL,
        session_version INT NOT NULL DEFAULT 1,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
    ) {TABLE_OPTIONS}',

    'CREATE TABLE projects (
        id {ID} PRIMARY KEY,
        user_id {ID} NOT NULL,
        name VARCHAR(120) NOT NULL,
        description VARCHAR(500) NOT NULL DEFAULT \'\',
        data {LONGTEXT} NOT NULL,
        revision INT NOT NULL DEFAULT 1,
        share_token VARCHAR(64) NULL UNIQUE,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        opened_at BIGINT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) {TABLE_OPTIONS}',
    'CREATE INDEX idx_projects_user ON projects (user_id)',

    'CREATE TABLE versions (
        id {ID} PRIMARY KEY,
        project_id {ID} NOT NULL,
        label VARCHAR(120) NOT NULL,
        data {LONGTEXT} NOT NULL,
        created_at BIGINT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    ) {TABLE_OPTIONS}',
    'CREATE INDEX idx_versions_project ON versions (project_id, created_at)',

    'CREATE TABLE tokens (
        id {ID} PRIMARY KEY,
        user_id {ID} NOT NULL,
        type VARCHAR(16) NOT NULL,
        token_hash CHAR(64) NOT NULL UNIQUE,
        expires_at BIGINT NOT NULL,
        used_at BIGINT NULL,
        created_at BIGINT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) {TABLE_OPTIONS}',

    'CREATE TABLE rate_limits (
        k VARCHAR(191) PRIMARY KEY,
        window_start BIGINT NOT NULL,
        hits INT NOT NULL
    ) {TABLE_OPTIONS}',
];
