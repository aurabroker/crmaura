import { createClient } from '@supabase/supabase-js';
import type { Database } from './types/database';

export const SB_URL = 'https://kukvgsjrmrqtzhkszzum.supabase.co';
export const SB_ANON_KEY =
	'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1a3Znc2pybXJxdHpoa3N6enVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MTI0NzYsImV4cCI6MjA4ODQ4ODQ3Nn0.wOB-4CJTcRksSUY7WD7CXEccTKNxPIVF8AT8hczS5zY';

export const sb = createClient<Database>(SB_URL, SB_ANON_KEY, {
	auth: {
		persistSession: true,
		autoRefreshToken: true
	}
});
