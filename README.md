# partner-gateway-proxy

> partner-mcp-gateway

## О проекте

Учебный проект на TypeScript. Цель - пройти путь от пустого репо до работающей системы через серию задач, которые наставник ставит в issues.

## Стек

- Node.js >= 20
- TypeScript (`tsc` -> `dist/`)
- `ts-node` для запуска `npm run dev` без сборки
- Vitest для тестов
- ESLint + `@typescript-eslint` для линта

## Структура

```
src/
├── index.ts        - точка входа (CLI + сборка дефолтного router)
└── routing/        - декларативная routing-таблица + матчер (Task #2)
    ├── types.ts    - HttpMethod, Route, UpstreamPool, RouteMatchResult
    ├── config.ts   - DEFAULT_ROUTES / DEFAULT_POOLS
    ├── router.ts   - createRouter(routes, pools) -> Router
    └── index.ts    - re-exports

tests/    - тесты vitest (*.test.ts)
dist/     - артефакты сборки (не коммитятся)
```

## Routing

Маршруты описаны декларативно через `(method, path) -> pool name` в `src/routing/config.ts`. Каждый pool несёт массив endpoint-ов - на следующих этапах сюда лягут load balancing и health checks.

```ts
import { createRouter, DEFAULT_ROUTES, DEFAULT_POOLS } from './routing';

const router = createRouter(DEFAULT_ROUTES, DEFAULT_POOLS);
const result = router.match('POST', '/v1/billing/invoice');
// { ok: true, route, pool: { name: 'billing', endpoints: [...] } }
// либо { ok: false, reason: 'no_route' | 'method_not_allowed', ... }
```

Матчинг точный - без wildcard и префиксов. `createRouter` fail-fast: дубли маршрутов и ссылки на несуществующие pool-ы валятся при конструировании, не в проде.

## Запуск и проверка

```bash
npm install      # установить зависимости
npm run dev      # запустить точку входа через ts-node
npm run build    # собрать TypeScript в dist/
npm start        # запустить собранный dist/index.js
npm test         # прогнать тесты (vitest run)
npm run lint     # проверить код eslint'ом
```

CI прогоняет `lint -> build -> test` на каждый PR (см. `.github/workflows/ci.yml`).

## Как работать

1. Открой issue с очередной задачей и прочитай критерии приёмки.
2. Создай feature-ветку, реализуй, открой PR в `main`.
3. Дождись ревью наставника - он закрывает PR и ставит следующую задачу.

## Концепции, которые отрабатываются

- [Rate Limiting & Throttling](https://mind-forge.ru/lesson/sd-17-rate-limiting)
- [Load Balancer](https://mind-forge.ru/lesson/sd-06-load-balancer)
- [API Gateway](https://mind-forge.ru/lesson/sd-11-api-gateway)
- [Service Mesh](https://mind-forge.ru/lesson/sd-12-service-mesh)
- [Observability](https://mind-forge.ru/lesson/sd-22-observability)
- [HTTP: язык веба](https://mind-forge.ru/lesson/net-21-http-basics)
