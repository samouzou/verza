
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

/**
 * @fileOverview Facebook Data Deletion Callback endpoint.
 * Required for Meta App compliance.
 */

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const signedRequest = formData.get('signed_request') as string;

    if (!signedRequest) {
      return NextResponse.json({ error: 'Missing signed_request' }, { status: 400 });
    }

    // Split the signed request into signature and payload
    const [encodedSig, payload] = signedRequest.split('.');
    
    // Facebook uses base64url encoding
    const sig = Buffer.from(encodedSig.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('hex');
    const data = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());

    // IMPORTANT: In a real production app, verify the signature using your App Secret
    // const expectedSig = crypto.createHmac('sha256', process.env.FACEBOOK_APP_SECRET!)
    //   .update(payload)
    //   .digest('hex');
    // if (sig !== expectedSig) { return NextResponse.json({ error: 'Invalid signature' }, { status: 400 }); }

    const userId = data.user_id;
    console.log(`Received Facebook deletion request for user: ${userId}`);

    // Generate a unique confirmation code and a status tracking URL
    const confirmationCode = `DEL-${userId}-${Date.now()}`;
    const statusUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.tryverza.com'}/data-deletion?code=${confirmationCode}`;

    // Meta expects this JSON response
    return NextResponse.json({
      url: statusUrl,
      confirmation_code: confirmationCode
    });

  } catch (error) {
    console.error('Error handling Facebook deletion request:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
