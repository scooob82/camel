<?php
declare(strict_types=1);

// Usage: php api/bin/make-admin.php user@example.com
require __DIR__ . '/../src/bootstrap.php';

$email = mb_strtolower(trim($argv[1] ?? ''));
if ($email === '') {
    fwrite(STDERR, "Usage: php api/bin/make-admin.php <email>\n");
    exit(1);
}
$db = new Cas\Db(Cas\Config::load());
$n = $db->exec("UPDATE users SET role = 'admin' WHERE email = ?", [$email]);
echo $n ? "$email is now an admin.\n" : "No user with e-mail $email (register first).\n";
exit($n ? 0 : 1);
