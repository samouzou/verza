
"use client";

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Mail, PlusCircle, UserPlus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';

interface InviteTalentCardProps {
  agencyId: string;
  disabled: boolean;
}

export function InviteTalentCard({ agencyId, disabled }: InviteTalentCardProps) {
  const [inviteEmail, setInviteEmail] = useState("");
  const [isInviting, setIsInviting] = useState(false);
  const { toast } = useToast();
  const inviteTalentCallable = httpsCallable(functions, 'inviteTalentToAgency');

  const handleInviteTalent = async () => {
    if (!inviteEmail.trim() || !/^\S+@\S+\.\S+$/.test(inviteEmail)) {
      toast({ title: "Invalid Email", description: "Please enter a valid email address.", variant: "destructive" });
      return;
    }
    
    setIsInviting(true);
    try {
      await inviteTalentCallable({ agencyId: agencyId, talentEmail: inviteEmail.trim() });
      toast({ title: "Invitation Sent", description: `An invitation has been sent to ${inviteEmail}.` });
      setInviteEmail("");
    } catch (error: any) {
      console.error("Error inviting talent:", error);
      toast({ title: "Invitation Failed", description: error.message || "Could not invite talent.", variant: "destructive" });
    } finally {
      setIsInviting(false);
    }
  };

  return (
    <Card id="invite-talent-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><UserPlus className="text-primary"/> Invite Talent</CardTitle>
        <CardDescription>Invite creators to join your agency via email.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-grow">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
                type="email" 
                placeholder="creator@example.com" 
                className="pl-10"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                disabled={isInviting || disabled}
            />
          </div>
          <Button onClick={handleInviteTalent} disabled={isInviting || !inviteEmail.trim() || disabled}>
            {isInviting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
            Send Invite
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
