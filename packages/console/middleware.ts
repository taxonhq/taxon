import createMiddleware from 'next-intl/middleware';
import { routing } from './src/i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Match all paths except Next.js internals and static files
  matcher: ['/((?!_next|api|favicon\\.svg|.*\\..*).*)'],
};
