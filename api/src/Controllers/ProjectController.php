<?php
declare(strict_types=1);

namespace Cas\Controllers;

use Cas\App;
use Cas\Http\HttpError;
use Cas\Http\Request;
use Cas\Support;

use function Cas\now;

final class ProjectController
{
    public function __construct(private App $app)
    {
    }

    private function present(array $p, array $versions): array
    {
        return [
            'id' => $p['id'],
            'name' => $p['name'],
            'description' => $p['description'],
            'createdAt' => (int) $p['created_at'],
            'updatedAt' => (int) $p['updated_at'],
            'openedAt' => (int) $p['opened_at'],
            'revision' => (int) $p['revision'],
            'shareToken' => $p['share_token'],
            'file' => Support::decode($p['data']),
            'versions' => array_map(fn ($v) => ['id' => $v['id'], 'label' => $v['label'], 'at' => (int) $v['created_at'], 'file' => Support::decode($v['data'])], $versions),
        ];
    }

    private function own(string $id, array $user): array
    {
        $p = $this->app->db->one('SELECT * FROM projects WHERE id = ? AND user_id = ?', [$id, $user['id']]);
        return $p ?? throw HttpError::notFound('Project');
    }

    private function name(mixed $v, array &$errors): string
    {
        $name = is_string($v) ? trim($v) : '';
        if ($name === '' || mb_strlen($name) > 120) {
            $errors['name'] = 'Name must be 1–120 characters.';
        }
        return $name;
    }

    public function list(): array
    {
        $user = $this->app->auth->require();
        $projects = $this->app->db->all('SELECT * FROM projects WHERE user_id = ? ORDER BY opened_at DESC', [$user['id']]);
        $versions = $this->app->db->all('SELECT v.* FROM versions v JOIN projects p ON p.id = v.project_id WHERE p.user_id = ? ORDER BY v.created_at DESC', [$user['id']]);
        $by = [];
        foreach ($versions as $v) {
            $by[$v['project_id']][] = $v;
        }
        $limits = $this->app->limits($user);
        return ['projects' => array_map(fn ($p) => $this->present($p, $by[$p['id']] ?? []), $projects), 'limits' => $limits];
    }

    public function show(Request $req): array
    {
        $user = $this->app->auth->require();
        $p = $this->own($req->params['id'], $user);
        $versions = $this->app->db->all('SELECT * FROM versions WHERE project_id = ? ORDER BY created_at DESC', [$p['id']]);
        return ['project' => $this->present($p, $versions)];
    }

    public function create(Request $req): array
    {
        $user = $this->app->auth->require();
        $limits = $this->app->limits($user);
        $count = (int) $this->app->db->value('SELECT COUNT(*) FROM projects WHERE user_id = ?', [$user['id']]);
        if ($count >= (int) $limits['projects']) {
            throw new HttpError(403, 'limit_reached', sprintf('Your plan allows %d projects.', $limits['projects']));
        }
        $errors = [];
        $name = $this->name($req->input('name'), $errors);
        $description = mb_substr($req->string('description'), 0, 500);
        if ($errors) {
            throw HttpError::validation($errors);
        }
        $data = Support::projectData($req->input('file'), (int) $limits['project_bytes']);
        $id = $req->input('id');
        // Client-generated ids are accepted (migration from browser storage) unless taken
        if (!Support::validId($id) || $this->app->db->value('SELECT 1 FROM projects WHERE id = ?', [$id])) {
            $id = Support::id('p_');
        }
        $now = now();
        $ts = fn (string $k) => is_int($req->input($k)) && $req->input($k) > 0 && $req->input($k) <= $now ? $req->input($k) : $now;
        $row = [
            'id' => $id,
            'user_id' => $user['id'],
            'name' => $name,
            'description' => $description,
            'data' => $data,
            'revision' => 1,
            'share_token' => null,
            'created_at' => $ts('createdAt'),
            'updated_at' => $ts('updatedAt'),
            'opened_at' => $ts('openedAt'),
        ];
        $versions = $req->input('versions', []);
        $this->app->db->transaction(function () use ($row, $versions, $limits) {
            $this->app->db->insert('projects', $row);
            if (is_array($versions)) {
                foreach (array_slice($versions, 0, (int) $limits['versions']) as $v) {
                    if (is_array($v)) {
                        $this->insertVersion($row['id'], $v, (int) $limits['project_bytes']);
                    }
                }
            }
        });
        $p = $this->app->db->one('SELECT * FROM projects WHERE id = ?', [$row['id']]);
        $v = $this->app->db->all('SELECT * FROM versions WHERE project_id = ? ORDER BY created_at DESC', [$row['id']]);
        return ['project' => $this->present($p, $v)];
    }

    public function update(Request $req): array
    {
        $user = $this->app->auth->require();
        $p = $this->own($req->params['id'], $user);
        $limits = $this->app->limits($user);
        $set = [];
        $errors = [];
        $body = $req->json();
        if (array_key_exists('name', $body)) {
            $set['name'] = $this->name($body['name'], $errors);
        }
        if (array_key_exists('description', $body)) {
            $set['description'] = mb_substr(is_string($body['description']) ? trim($body['description']) : '', 0, 500);
        }
        if ($errors) {
            throw HttpError::validation($errors);
        }
        if (array_key_exists('file', $body)) {
            $set['data'] = Support::projectData($body['file'], (int) $limits['project_bytes']);
        }
        $touchOnly = $set === [];
        if (isset($body['openedAt']) && is_int($body['openedAt'])) {
            $set['opened_at'] = min($body['openedAt'], now());
        }
        // Optimistic concurrency: reject stale writes from another tab/device
        if (!$touchOnly && isset($body['baseRevision']) && (int) $body['baseRevision'] !== (int) $p['revision']) {
            throw new HttpError(409, 'conflict', 'This project was changed elsewhere. Reload to get the latest version.');
        }
        if (!$set) {
            return ['revision' => (int) $p['revision'], 'updatedAt' => (int) $p['updated_at']];
        }
        $revision = (int) $p['revision'];
        $updatedAt = (int) $p['updated_at'];
        if (!$touchOnly) {
            $revision++;
            $updatedAt = now();
            $set['revision'] = $revision;
            $set['updated_at'] = $updatedAt;
        }
        $cols = implode(', ', array_map(fn ($c) => "$c = :$c", array_keys($set)));
        $this->app->db->exec("UPDATE projects SET $cols WHERE id = :id", $set + ['id' => $p['id']]);
        return ['revision' => $revision, 'updatedAt' => $updatedAt];
    }

    public function delete(Request $req): array
    {
        $user = $this->app->auth->require();
        $p = $this->own($req->params['id'], $user);
        $this->app->db->transaction(function () use ($p) {
            $this->app->db->exec('DELETE FROM versions WHERE project_id = ?', [$p['id']]);
            $this->app->db->exec('DELETE FROM projects WHERE id = ?', [$p['id']]);
        });
        return ['ok' => true];
    }

    private function insertVersion(string $projectId, array $v, int $maxBytes): array
    {
        $label = is_string($v['label'] ?? null) ? mb_substr(trim($v['label']), 0, 120) : '';
        $row = [
            'id' => Support::validId($v['id'] ?? null) && !$this->app->db->value('SELECT 1 FROM versions WHERE id = ?', [$v['id']]) ? $v['id'] : Support::id('v_'),
            'project_id' => $projectId,
            'label' => $label !== '' ? $label : 'Version',
            'data' => Support::projectData($v['file'] ?? null, $maxBytes),
            'created_at' => is_int($v['at'] ?? null) && $v['at'] > 0 && $v['at'] <= now() ? $v['at'] : now(),
        ];
        $this->app->db->insert('versions', $row);
        return $row;
    }

    public function addVersion(Request $req): array
    {
        $user = $this->app->auth->require();
        $p = $this->own($req->params['id'], $user);
        $limits = $this->app->limits($user);
        $row = $this->insertVersion($p['id'], $req->json(), (int) $limits['project_bytes']);
        // keep only the newest N versions
        $old = $this->app->db->all('SELECT id FROM versions WHERE project_id = ? ORDER BY created_at DESC', [$p['id']]);
        foreach (array_slice($old, (int) $limits['versions']) as $o) {
            $this->app->db->exec('DELETE FROM versions WHERE id = ?', [$o['id']]);
        }
        return ['version' => ['id' => $row['id'], 'label' => $row['label'], 'at' => $row['created_at']]];
    }

    public function deleteVersion(Request $req): array
    {
        $user = $this->app->auth->require();
        $p = $this->own($req->params['id'], $user);
        $n = $this->app->db->exec('DELETE FROM versions WHERE id = ? AND project_id = ?', [$req->params['vid'], $p['id']]);
        if (!$n) {
            throw HttpError::notFound('Version');
        }
        return ['ok' => true];
    }

    public function share(Request $req): array
    {
        $user = $this->app->auth->require();
        $p = $this->own($req->params['id'], $user);
        $token = $p['share_token'] ?: Support::token();
        $this->app->db->exec('UPDATE projects SET share_token = ? WHERE id = ?', [$token, $p['id']]);
        return ['token' => $token, 'url' => $this->app->link('/s/' . $token)];
    }

    public function unshare(Request $req): array
    {
        $user = $this->app->auth->require();
        $p = $this->own($req->params['id'], $user);
        $this->app->db->exec('UPDATE projects SET share_token = NULL WHERE id = ?', [$p['id']]);
        return ['ok' => true];
    }

    public function shared(Request $req): array
    {
        $this->app->limiter->hit('shared:' . $req->ip, 120, 60);
        $p = $this->app->db->one('SELECT p.*, u.name AS owner FROM projects p JOIN users u ON u.id = p.user_id WHERE p.share_token = ?', [$req->params['token']]);
        if (!$p) {
            throw HttpError::notFound('Shared project');
        }
        return ['project' => ['name' => $p['name'], 'description' => $p['description'], 'owner' => $p['owner'], 'updatedAt' => (int) $p['updated_at'], 'file' => Support::decode($p['data'])]];
    }
}
