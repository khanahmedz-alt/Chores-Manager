// Joins supabase/functions/contact/handler.ts + index.ts into one file for the Supabase dashboard editor.
import { readFileSync, writeFileSync } from 'node:fs';
const dir = new URL('../supabase/functions/', import.meta.url);
const h = readFileSync(new URL('contact/handler.ts', dir), 'utf8');
const imp = "import { createClient } from 'npm:@supabase/supabase-js@2.118.0';\n";
const i = readFileSync(new URL('contact/index.ts', dir), 'utf8').replace(imp, '')
  .replace("import { DbError, EMAIL_TO, handleContact, type OutgoingEmail } from './handler.ts';\n", '');
const header = `// ONE-FILE VERSION of the "contact" Edge Function, for pasting into the Supabase dashboard
// (Edge Functions → Deploy a new function → Via Editor). It is contact/handler.ts + contact/index.ts
// joined together; regenerate it with:  node scripts/bundle-contact.mjs
`;
writeFileSync(new URL('contact-single-file.ts', dir), header + imp + '\n// ---------- handler.ts ----------\n' + h + '\n// ---------- index.ts ----------\n' + i);
console.log('wrote supabase/functions/contact-single-file.ts');
