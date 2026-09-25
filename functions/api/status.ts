import { status, type Env } from '../../src/server/api';
export const onRequestGet = ({ request, env }: { request: Request; env: Env }) => status(request, env);
