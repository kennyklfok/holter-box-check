import { lockCode, type Env } from '../../src/server/api';

export const onRequestGet = ({ request, env }: { request: Request; env: Env }) => lockCode(request, env);
export const onRequestPut = ({ request, env }: { request: Request; env: Env }) => lockCode(request, env);
