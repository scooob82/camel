<?php
declare(strict_types=1);

if (PHP_VERSION_ID < 80200) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['error' => ['code' => 'php_version', 'message' => 'PHP 8.2 or newer is required']]);
    exit;
}

require __DIR__ . '/functions.php';

spl_autoload_register(static function (string $class): void {
    if (!str_starts_with($class, 'Cas\\')) {
        return;
    }
    $path = __DIR__ . '/' . str_replace('\\', '/', substr($class, 4)) . '.php';
    if (is_file($path)) {
        require $path;
    }
});
