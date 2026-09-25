import { login, type Env } from '../../src/server/api';
export const onRequestPost = ({ request, env }: { request: Request; env: Env }) => login(request, env);
