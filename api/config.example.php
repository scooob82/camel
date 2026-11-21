<?php
/*
 * Copy to one of (first found wins):
 *   - ../cas-config.php  (one level ABOVE the web root — recommended, never web-accessible)
 *   - api/config.php     (protected by api/.htaccess)
 * or point the CAS_CONFIG environment variable to the file.
 */
return [
    'app_url' => 'https://www.example.com',   // public URL of the site, used in e-mail links
    'app_name' => 'Camel Studio',
    'debug' => false,

    'db' => [
        'dsn' => 'mysql:host=localhost;dbname=studio;charset=utf8mb4',
        'user' => 'studio',
        'password' => 'change-me',
    ],

    'mail' => [
        'driver' => 'smtp',                    // smtp | mail | log
        'from' => 'no-reply@example.com',
        'from_name' => 'Camel Studio',
        'smtp' => [
            'host' => 'smtp.example.com',
            'port' => 587,
            'secure' => 'tls',                 // tls (STARTTLS, port 587) | ssl (port 465) | '' (none)
            'user' => 'no-reply@example.com',
            'password' => 'change-me',
        ],
    ],

    'session' => [
        'name' => 'cas_session',
        'lifetime' => 60 * 60 * 24 * 30,       // 30 days
        'secure' => true,                      // cookies only over HTTPS
    ],

    // Optional: sandbox runner for Run & Debug and the Saxon engine (see runner/README.md).
    // 'runner' => [
    //     'url' => 'http://runner.example.com:8090',
    //     'token' => 'same value as RUNNER_TOKEN of the runner',
    //     'daily_runs' => ['free' => 20, 'pro' => null, 'team' => null], // null = unlimited, 0 = not in plan
    // ],

    // Optional: enables POST /api/v1/setup/migrate with header "X-Setup-Token: <token>"
    // for hostings without a usable shell. Leave empty to disable.
    'setup_token' => '',
];
