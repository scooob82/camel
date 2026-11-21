<?php
// Local full-stack dev server (static app + API on one origin):
//   npm run build && php -S 127.0.0.1:8080 -t dist scripts/dev-router.php
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
if (str_starts_with($path, '/api/')) {
    $_SERVER['SCRIPT_NAME'] = '/api/index.php';
    require __DIR__ . '/../api/index.php';
    return true;
}
return false; // let the built-in server serve files from dist/
