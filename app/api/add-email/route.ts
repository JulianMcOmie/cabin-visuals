import { NextRequest, NextResponse } from 'next/server';

import Airtable from 'airtable';

const apiKey = process.env.AIRTABLE_API_KEY;
const baseId = process.env.AIRTABLE_BASE_ID;
const tableName = process.env.AIRTABLE_TABLE_NAME || 'Waitlist';

let base: Airtable.Base | null = null;
if (apiKey && baseId) {
  base = new Airtable({ apiKey }).base(baseId);
} else {
  console.error("Airtable API Key or Base ID is missing. API route will not function correctly.");
}

export async function POST(request: NextRequest) {
  if (!base || !apiKey || !baseId) {
    return NextResponse.json({ error: 'Airtable configuration missing on the server.' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const email = body.email;

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required and must be a string.' }, { status: 400 });
    }

    try {
      await base(tableName).create([
        {
          fields: {
            'Email': email,
          },
        },
      ]);
      
      return NextResponse.json({ message: 'Successfully added to waitlist!' }, { status: 200 });

    } catch (airtableError: any) {
      console.error('Airtable API error:', airtableError);
      const errorMessage = airtableError.message || 'Failed to add email to the waitlist.';
      let statusCode = 500;
      if (airtableError.statusCode) {
         statusCode = airtableError.statusCode;
      }
      return NextResponse.json({ error: `Airtable error: ${errorMessage}` }, { status: statusCode });
    }

  } catch (error) {
    console.error('API route error:', error);
    if (error instanceof SyntaxError) {
        return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
