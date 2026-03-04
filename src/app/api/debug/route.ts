import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET() {
    const admin = createAdminClient();
    const { data } = await admin.from('players').select('name, height_cm, secondary_positions, date_of_birth, nationality, api_football_id, web_name').ilike('name', '%watkins%');
    return NextResponse.json(data);
}
