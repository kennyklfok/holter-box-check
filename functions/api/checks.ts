import { recordCheck, type Env } from '../../src/server/api';
export const onRequestPost = ({ request, env }: { request: Request; env: Env }) => recordCheck(request, env);
