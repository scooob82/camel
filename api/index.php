<?php
declare(strict_types=1);

/*
 * Front controller of the Studio API.
 * Apache: requests under /api/ are rewritten here by api/.htaccess.
 * Dev:    php -S 127.0.0.1:8080 scripts/dev-router.php
 */

require __DIR__ . '/src/bootstrap.php';

$app = new Cas\App(Cas\Config::load());
$app->run();
