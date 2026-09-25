import { history, type Env } from '../../src/server/api';
export const onRequestGet = ({ request, env }: { request: Request; env: Env }) => history(request, env);
