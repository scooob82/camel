<?php
declare(strict_types=1);

namespace Cas;

use PDO;

/** Thin PDO wrapper. Works with MariaDB/MySQL in production and SQLite in dev/tests. */
final class Db
{
    public readonly PDO $pdo;
    public readonly string $driver;

    public function __construct(Config $config)
    {
        $dsn = (string) $config->get('db.dsn');
        if (str_starts_with($dsn, 'sqlite:')) {
            $file = substr($dsn, 7);
            if ($file !== ':memory:' && !is_dir(dirname($file))) {
                @mkdir(dirname($file), 0775, true);
            }
        }
        $this->pdo = new PDO($dsn, $config->get('db.user'), $config->get('db.password'), [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        $this->driver = (string) $this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
        if ($this->driver === 'sqlite') {
            $this->pdo->exec('PRAGMA foreign_keys = ON');
            $this->pdo->exec('PRAGMA journal_mode = WAL');
        }
    }

    /** @return list<array<string,mixed>> */
    public function all(string $sql, array $params = []): array
    {
        $st = $this->pdo->prepare($sql);
        $st->execute($params);
        return $st->fetchAll();
    }

    /** @return array<string,mixed>|null */
    public function one(string $sql, array $params = []): ?array
    {
        $st = $this->pdo->prepare($sql);
        $st->execute($params);
        $row = $st->fetch();
        return $row === false ? null : $row;
    }

    public function value(string $sql, array $params = []): mixed
    {
        $st = $this->pdo->prepare($sql);
        $st->execute($params);
        $v = $st->fetchColumn();
        return $v === false ? null : $v;
    }

    public function exec(string $sql, array $params = []): int
    {
        $st = $this->pdo->prepare($sql);
        $st->execute($params);
        return $st->rowCount();
    }

    public function insert(string $table, array $row): void
    {
        $cols = array_keys($row);
        $sql = sprintf('INSERT INTO %s (%s) VALUES (%s)', $table, implode(', ', $cols), implode(', ', array_map(fn ($c) => ":$c", $cols)));
        $this->exec($sql, $row);
    }

    public function transaction(callable $fn): mixed
    {
        $this->pdo->beginTransaction();
        try {
            $r = $fn();
            $this->pdo->commit();
            return $r;
        } catch (\Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
    }

    // ------------------------------------------------------------ migrations

    /** Apply pending migrations from api/migrations. Returns applied versions. */
    public function migrate(): array
    {
        $this->pdo->exec('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(64) PRIMARY KEY, applied_at BIGINT NOT NULL)');
        $done = array_column($this->all('SELECT version FROM schema_migrations'), 'version');
        $files = glob(dirname(__DIR__) . '/migrations/*.php') ?: [];
        sort($files);
        $applied = [];
        foreach ($files as $file) {
            $version = basename($file, '.php');
            if (in_array($version, $done, true)) {
                continue;
            }
            /** @var list<string> $statements */
            $statements = require $file;
            foreach ($statements as $sql) {
                $this->pdo->exec($this->dialect($sql));
            }
            $this->insert('schema_migrations', ['version' => $version, 'applied_at' => now()]);
            $applied[] = $version;
        }
        return $applied;
    }

    /** Replace portable type placeholders with driver specific SQL. */
    private function dialect(string $sql): string
    {
        $mysql = $this->driver === 'mysql';
        return strtr($sql, [
            '{ID}' => 'VARCHAR(64)',
            '{LONGTEXT}' => $mysql ? 'LONGTEXT' : 'TEXT',
            '{TABLE_OPTIONS}' => $mysql ? 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci' : '',
        ]);
    }
}
