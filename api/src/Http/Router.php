<?php
declare(strict_types=1);

namespace Cas\Http;

final class Router
{
    /** @var list<array{string,string,callable,array}> */
    private array $routes = [];

    /** @param array{auth?:bool} $opts */
    public function add(string $method, string $pattern, callable $handler, array $opts = []): void
    {
        $regex = '#^' . preg_replace('#\{(\w+)\}#', '(?P<$1>[A-Za-z0-9_-]+)', $pattern) . '$#';
        $this->routes[] = [$method, $regex, $handler, $opts];
    }

    /** @return array{callable,array}|null */
    public function match(Request $req): ?array
    {
        $allowed = [];
        foreach ($this->routes as [$method, $regex, $handler, $opts]) {
            if (preg_match($regex, $req->path, $m)) {
                if ($method !== $req->method) {
                    $allowed[] = $method;
                    continue;
                }
                $req->params = array_filter($m, 'is_string', ARRAY_FILTER_USE_KEY);
                return [$handler, $opts];
            }
        }
        if ($allowed) {
            throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
        }
        return null;
    }
}
