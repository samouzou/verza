import { Badge } from "@/components/ui/badge";
import type { Contract } from "@/types";

interface ContractStatusBadgeProps {
  status: Contract['status'];
}

export function ContractStatusBadge({ status }: ContractStatusBadgeProps) {
  let variant: "default" | "secondary" | "destructive" | "outline" = "default";
  let text = status.charAt(0).toUpperCase() + status.slice(1);
  let customClassName = "capitalize";

  switch (status) {
    case 'pending':
      text = 'Pending';
      // Custom styling for pending to ensure visibility on card background
      // This creates an "outline-like" badge using card-foreground colors.
      return <Badge className="border border-card-foreground/60 text-card-foreground bg-transparent hover:bg-card-foreground/10 capitalize">{text}</Badge>;
    case 'paid':
      // Custom style for "paid" to be green-ish
      return <Badge className="bg-green-500 hover:bg-green-600 text-primary-foreground capitalize">{text}</Badge>;
    case 'overdue':
      variant = 'destructive';
      text = 'Overdue';
      break;
    case 'at_risk':
      variant = 'destructive'; // Kept destructive for at_risk, could be yellow/orange too
      text = 'At Risk';
      break;
    case 'invoiced':
      variant = 'secondary';
      text = 'Invoiced';
      break;
    default:
      variant = 'outline';
      // For any other outline status, ensure it's visible on a card
      customClassName = "capitalize border-card-foreground/60 text-card-foreground bg-transparent hover:bg-card-foreground/10";
  }

  return <Badge variant={variant} className={customClassName}>{text.replace('_', ' ')}</Badge>;
}
