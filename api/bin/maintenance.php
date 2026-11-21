<?php
declare(strict_types=1);

/*
 * Daily maintenance — run from cron, e.g.:
 *   15 3 * * *  php /path/to/www/api/bin/maintenance.php >> /path/to/www/api/storage/logs/cron.log 2>&1
 *
 * - prunes expired tokens and old rate-limit rows
 * - writes a gzipped JSON backup of all tables to storage/backups (keeps the last 14)
 *   Copy that folder off the server regularly (the hosting backup alone is not enough).
 */
require __DIR__ . '/../src/bootstrap.php';

use Cas\Config;
use Cas\Db;
use Cas\RateLimiter;

use function Cas\now;

$config = Config::load();
$db = new Db($config);

$tokens = $db->exec('DELETE FROM tokens WHERE expires_at < ? OR used_at IS NOT NULL AND used_at < ?', [now(), now() - 7 * 86400000]);
$limits = (new RateLimiter($db))->prune();

$dir = $config->storage('backups');
$file = sprintf('%s/backup-%s.json.gz', $dir, date('Ymd-His'));
$gz = gzopen($file, 'wb6');
gzwrite($gz, '{"createdAt":' . now() . ',"tables":{');
$first = true;
foreach (['users', 'projects', 'versions'] as $table) {
    gzwrite($gz, ($first ? '' : ',') . json_encode($table) . ':[');
    $first = false;
    $st = $db->pdo->query("SELECT * FROM $table");
    $n = 0;
    while ($row = $st->fetch()) {
        gzwrite($gz, ($n++ ? ',' : '') . json_encode($row, JSON_UNESCAPED_UNICODE));
    }
    gzwrite($gz, ']');
}
gzwrite($gz, '}}');
gzclose($gz);

$all = glob($dir . '/backup-*.json.gz') ?: [];
rsort($all);
foreach (array_slice($all, 14) as $old) {
    @unlink($old);
}

printf("[%s] tokens pruned: %d, rate limits pruned: %d, backup: %s\n", date('c'), $tokens, $limits, basename($file));
