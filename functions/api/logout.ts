import { logout, type Env } from '../../src/server/api';
export const onRequestPost = ({ request, env }: { request: Request; env: Env }) => logout(request, env);
