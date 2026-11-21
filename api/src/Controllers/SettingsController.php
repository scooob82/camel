<?php
declare(strict_types=1);

namespace Cas\Controllers;

use Cas\App;
use Cas\Http\HttpError;
use Cas\Http\Request;
use Cas\Support;

use function Cas\now;

/** Per-user settings synced across devices (currently: the snippets library). */
final class SettingsController
{
    private const MAX_SNIPPETS_BYTES = 1000000;

    public function __construct(private App $app)
    {
    }

    public function snippets(): array
    {
        $u = $this->app->auth->require();
        $json = $this->app->db->value('SELECT snippets FROM user_settings WHERE user_id = ?', [$u['id']]);
        return ['snippets' => $json ? Support::decode((string) $json) : []];
    }

    public function saveSnippets(Request $req): array
    {
        $u = $this->app->auth->require();
        $list = $req->input('snippets');
        if (!is_array($list) || !array_is_list($list)) {
            throw HttpError::validation(['snippets' => 'Expected a list.']);
        }
        $json = json_encode(array_slice($list, 0, 200), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        if (strlen($json) > self::MAX_SNIPPETS_BYTES) {
            throw new HttpError(413, 'too_large', 'Snippet library is too large.');
        }
        $exists = $this->app->db->value('SELECT 1 FROM user_settings WHERE user_id = ?', [$u['id']]);
        if ($exists) {
            $this->app->db->exec('UPDATE user_settings SET snippets = ?, updated_at = ? WHERE user_id = ?', [$json, now(), $u['id']]);
        } else {
            $this->app->db->insert('user_settings', ['user_id' => $u['id'], 'snippets' => $json, 'updated_at' => now()]);
        }
        return ['ok' => true];
    }
}
