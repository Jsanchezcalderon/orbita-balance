# Orbita · Servicio de saldo

API (NestJS + TypeScript + PostgreSQL) y pantalla web (React + Vite) para el saldo prepago en USD.
Monorepositorio con pnpm workspaces: `api/` y `web/`.

## Cómo correrlo

Requisitos: Docker Desktop (opciones A y B) o PostgreSQL 14+ local (opción C), y para B/C también Node 20+ y pnpm
(`packageManager: pnpm@10.0.0`; con `corepack enable` se usa esa versión).

Primero, en todos los casos:

```bash
cp .env.example .env        # Windows (cmd): copy .env.example .env
```

Hay tres formas de ejecutarlo. Elige **una** y no las mezcles: usan los mismos puertos (3000, 5173 y 5432).

| Opción | BD | API y web | Cuándo usarla |
|---|---|---|---|
| **A. Todo en Docker** | Contenedor `db` | Contenedores `api` y `web` | Probarlo sin instalar Node ni Postgres |
| **B. BD en Docker, API y web locales** | Contenedor `db` | `pnpm dev` | Desarrollo con recarga en caliente |
| **C. BD local (Laragon u otro)** | Postgres instalado | `pnpm dev` | Sin Docker |

### A. Todo en Docker

```bash
docker compose up -d --build
```

- Levanta `db`, `api` y `web` (`docker-compose.yml`, con `api/Dockerfile` y `web/Dockerfile`).
- La API espera a que la BD esté saludable (`healthcheck`) antes de arrancar.
- Dentro de la red de Compose la BD se llama `db`, no `localhost`, por eso el compose **sobrescribe**
  `DATABASE_URL` (y `CORS_ORIGIN`) para el servicio `api`. El `DATABASE_URL` de tu `.env` se ignora en esta opción;
  el resto de variables (`JWT_SECRET`, `WEBHOOK_SECRET`...) sí salen del `.env` (`env_file`).
- `.dockerignore` deja fuera `.env`, `node_modules` y `dist`: los secretos no quedan dentro de las imágenes.
- Si cambias código o `VITE_API_URL` (URL de la API que usa el navegador, se incrusta al compilar la web),
  reconstruye con `docker compose up -d --build`.
- Logs: `docker compose logs -f api`. Detener: `docker compose down` (con `-v` también borra los datos de la BD).

### B. Solo la BD en Docker (API y web locales)

```bash
pnpm db:up        # = docker compose up -d db
pnpm install
pnpm dev          # API :3000 + web :5173
pnpm db:down      # al terminar (= docker compose down)
```

En el `.env` debe estar la URL con `localhost` (es la que trae `.env.example` por defecto):

```
DATABASE_URL=postgres://orbita:orbita@localhost:5432/orbita
TEST_DATABASE_URL=postgres://orbita:orbita@localhost:5432/orbita_test
```

### C. BD local (Laragon u otro PostgreSQL)

1. Inicia PostgreSQL y crea las bases `orbita` y `orbita_test`.
2. En `.env`, apunta a tu servidor local (ejemplo comentado en `.env.example`):
   ```
   DATABASE_URL=postgres://postgres:TU_PASS@localhost:5432/orbita
   TEST_DATABASE_URL=postgres://postgres:TU_PASS@localhost:5432/orbita_test
   ```
3. `pnpm install` y `pnpm dev`.

### Cambiar entre opciones

- **De Docker a BD local:** `docker compose down` (libera los puertos 3000, 5173 y 5432), inicia Postgres local y
  ajusta `DATABASE_URL` en `.env`. Docker no modifica tu `.env`.
- **Datos separados:** el volumen `pgdata` de Docker y la BD local son bases distintas. Usuarios de prueba, saldos y
  movimientos de una no aparecen en la otra.
- **Conflicto de puerto 5432:** si Postgres local está corriendo, el contenedor `db` no puede publicar el mismo puerto.
  Detén uno de los dos.

La API aplica `schema.sql` y crea los usuarios de prueba al arrancar (`SEED_ON_START=true`), en cualquiera de las opciones.

| Servicio | URL |
|---|---|
| Web | http://localhost:5173 |
| API | http://localhost:3000 (`GET /health`) |
| Swagger UI | http://localhost:3000/docs (OpenAPI JSON en `/docs/json`) |

### Pruebas

```bash
pnpm test                    # API (necesita PostgreSQL) + web
pnpm --filter @orbita/api test
pnpm --filter @orbita/web test
pnpm typecheck
```

Las pruebas de la API crean la base `orbita_test` si no existe. La web usa MSW para simular la API.

## Usuarios de prueba

| id | email | contraseña |
|---|---|---|
| `u_123` | ana@orbita.test | `Ana12345!` |
| `u_456` | beto@orbita.test | `Beto12345!` |

## Probar el webhook

La firma es HMAC-SHA256 en hexadecimal del **body exacto**, con `WEBHOOK_SECRET`, en el header `X-Signature`
(el enunciado también lo llama `XSignature`; la API solo acepta `X-Signature`).

### Con curl (Git Bash)

```bash
BODY='{"event_id":"evt_8f2a","user_id":"u_123","amount":"200.00","currency":"USD","status":"approved"}'
SIG=$(pnpm --filter @orbita/api run --silent sign-webhook -- "$BODY")
curl -X POST http://localhost:3000/webhooks/payment-gateway \
  -H 'Content-Type: application/json' -H "X-Signature: $SIG" -d "$BODY"
```

### Con Postman

1. Crea un *Environment* con la variable `webhook_secret` (el `WEBHOOK_SECRET` de tu `.env`) y selecciónalo.
2. Crea una petición `POST http://localhost:3000/webhooks/payment-gateway`.
3. En **Body → raw → JSON** escribe el evento en **una sola línea y sin variables `{{}}`** (la firma depende del texto exacto):
   ```json
   {"event_id":"evt_8f2a","user_id":"u_123","amount":"200.00","currency":"USD","status":"approved"}
   ```
4. En **Scripts → Pre-request** pega este script (Postman incluye `CryptoJS`):
   ```javascript
   const body = pm.request.body.raw;
   const secret = pm.environment.get('webhook_secret');
   const signature = CryptoJS.HmacSHA256(body, secret).toString(CryptoJS.enc.Hex);
   pm.request.headers.upsert({ key: 'X-Signature', value: signature });
   ```
5. Envía. Para probar eventos nuevos cambia `event_id`; el script recalcula la firma solo.

Si responde `401 INVALID_SIGNATURE`: el secret no coincide con el `.env`, el body cambió (espacios o saltos de línea) o no está seleccionado el environment.

### Respuestas

`{"status":"processed"}`, `{"status":"duplicate"}` (evento repetido) o `{"status":"ignored"}` (rechazado).

## Endpoints

| Método y ruta | Auth | Notas |
|---|---|---|
| `POST /auth/login` | — | `{ email, password }` → `{ access_token, token_type, expires_in }` |
| `GET /balances/me` | Bearer | Crea el saldo en 0 si no existe |
| `POST /balances/me/deposits` | Bearer + `Idempotency-Key` | `{ amount: "150.25", currency: "USD" }` → 201 |
| `POST /balances/me/withdrawals` | Bearer + `Idempotency-Key` | 422 `INSUFFICIENT_FUNDS` si no alcanza |
| `GET /balances/me/transactions?page=1&limit=20` | Bearer | Más reciente primero; `limit` máx. 100 |
| `POST /webhooks/payment-gateway` | Firma `X-Signature` | Idempotente por `event_id` |

Errores siempre con este formato: `{ "error": { "code": "...", "message": "...", "details": [...] } }`.

## Mis consideraciones para el desarrollo

- **PostgreSQL con SQL explícito (`pg`), sin ORM.** Las garantías clave (unicidad, atomicidad, `CHECK`) se ven en el SQL. Docker Compose para reproducibilidad.
- **Dinero en centavos (`BIGINT`).** Nunca floats. La API recibe y devuelve strings (`"150.25"`) y valida: máx. 2 decimales, > 0, ≤ 10,000.
- **Saldo nunca negativo:** `UPDATE ... WHERE amount_cents >= monto` es atómico y bloquea la fila (los retiros concurrentes se serializan); además hay `CHECK (amount_cents >= 0)`.
- **Idempotencia depósito/retiro:** tabla `idempotency_keys` con PK `(user_id, key, endpoint)`. La llave se reserva con `INSERT ... ON CONFLICT DO NOTHING` en la misma transacción que mueve el saldo; una solicitud concurrente con la misma llave espera y recibe la respuesta guardada (`Idempotent-Replayed: true`). Misma llave con otro monto → 422. Los errores de negocio hacen rollback y no consumen la llave.
- **Webhook:** firma validada sobre el **body crudo** con comparación en tiempo constante, antes de interpretar el JSON. Duplicados evitados con la PK de `webhook_events(event_id)` en la misma transacción que acredita. Usuario inexistente → 404 con rollback (la pasarela puede reintentar). Los eventos `rejected` se registran y no acreditan.
- **Token: JWT HS256 de 15 minutos** (`jose`). Stateless, sin tabla de sesiones, suficiente para este alcance. Sin refresh token: al vencer, se inicia sesión de nuevo. Contraseñas con `bcryptjs` (cost 10).
- **Login sin enumeración de usuarios:** mismo 401 y mismo mensaje para email inexistente o contraseña incorrecta; se ejecuta `bcrypt.compare` contra un hash de relleno para igualar tiempos.
- **Usuario siempre del token:** las rutas 02–05 ignoran headers de usuario y el body rechaza campos extra (`.strict()`), p. ej. `user_id`.
- **Web:** token en `localStorage` para que la sesión sobreviva a recargas. Trade-off: es legible por JS (riesgo XSS).

## Qué dejé fuera / con más tiempo

- Límite de intentos de login y bloqueo temporal.
- Refresh tokens o cookie `HttpOnly`; rotación de secretos.
- Sesión única por usuario: hoy el JWT es stateless, así que un usuario puede tener varios tokens válidos a la vez
  (varios navegadores o dispositivos) y no hay forma de invalidarlos antes de que venzan. Con más tiempo, al iniciar
  sesión se invalidaría el token anterior: guardar un identificador de sesión (`jti` o `session_id`) por usuario en la
  BD (o Redis), incluirlo en el JWT y rechazar en el `AuthGuard` cualquier token cuyo identificador no sea el vigente
  (`401 SESSION_REVOKED`). Así, iniciar sesión en otro lugar cancela la sesión anterior, y de paso se habilita un
  `logout` real que revoca el token. Trade-off: cada petición protegida consulta ese estado (se mitiga con caché corta).
  El front ya limpia la sesión y vuelve al login ante un 401, así que solo habría que mostrar un aviso del tipo
  "Tu sesión se cerró porque iniciaste sesión en otro dispositivo".
- Migraciones versionadas (`node-pg-migrate`) en vez de `schema.sql`.
- Paginación por cursor; filtros por tipo/fecha en el historial.
- Deploy continuo: el CI (`.github/workflows/ci.yml`) ya corre typecheck, pruebas y build con PostgreSQL. Falta el job de despliegue (BD gestionada tipo Neon/Render; `DATABASE_URL` y secretos como *secrets*, nunca en el repo).

## Tiempo dedicado

_~5 horas._

## Uso de IA

Usé Claude Code (asistente de IA) como apoyo durante el desarrollo. Yo definí qué construir, tomé las decisiones
de diseño y revisé y probé los resultados; la IA generó borradores de código que yo pedí, corregí o descarté.

**Dónde la usé**

- **Inicio de monorepo:** scaffold inicial, esquema SQL, lógica de idempotencia/webhook, pruebas.
- **Documentación de la API:** pedí la documentación Swagger/OpenAPI (`/docs`) y la ajusté con el contexto real de la
  app (códigos de error, `Idempotency-Key`, firma del webhook, usuarios de prueba).
- **Documentación y explicaciones:** Pedí me ayude en la redacción del README para un mejor entendimiento tecnico.
- **Organización del trabajo:** pedí un plan de trabajo para convertirlo en mis specs para luego ir validando cada cambio realizado en el codigo y que no se saliera de las especificaciones.

**Qué revisé, decidí o rechacé yo**

- Descarté por ahora el ORM: el diseño sigue con SQL explícito (`pg`), para que las garantías (unicidad, atomicidad,
  `CHECK`) se vean en el SQL.
- Detecté el error de `pnpm typecheck` en la migración a NestJS (ampliación de tipos de `express`) y se corrigió.
- Corrijo comandos y documentación a `pnpm` para evitar confusión con npm.

**Límites**

- Parte del código generado por la IA (migración a NestJS, Swagger) lo verifiqué con `pnpm typecheck` y `pnpm test`.
  Cualquier cambio nuevo debe pasar `pnpm typecheck` y `pnpm test` antes de integrarse.
- Los secretos (`JWT_SECRET`, `WEBHOOK_SECRET`) nunca se comparten con la IA ni se suben al repositorio.
