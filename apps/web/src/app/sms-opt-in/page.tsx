import { SmsOptInFlowPreview } from "./sms-opt-in-flow-preview";

/**
 * Public SMS program disclosure for Twilio toll-free / A2P verification (e.g. error 30509).
 * Must stay reachable without login.
 */
export default function SmsOptInPage() {
  return <SmsOptInFlowPreview />;
}
