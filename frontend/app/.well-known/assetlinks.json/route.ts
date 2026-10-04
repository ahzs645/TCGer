import { appAssociations } from '@/lib/app-associations.mjs';
export const dynamic = 'force-static';
export function GET() {
  return Response.json(appAssociations().android);
}
