<?php
declare(strict_types=1);

// Usage: php api/bin/migrate.php   (uses the same config lookup as the API)
require __DIR__ . '/../src/bootstrap.php';

$db = new Cas\Db(Cas\Config::load());
$applied = $db->migrate();
echo $applied ? 'Applied: ' . implode(', ', $applied) . PHP_EOL : 'Database is up to date.' . PHP_EOL;
