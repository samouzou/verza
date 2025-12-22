
"use client";

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Loader2, Mail, PlusCircle, Shield } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';

interface InviteTeamMemberCardProps {
  agencyId: string;
  disabled: boolean;
}

export function InviteTeamMemberCard({ agencyId, disabled }: InviteTeamMemberCardProps) {
  const [inviteEmail, setInviteEmail] = useState("");
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [isInviting, setIsInviting] = useState(false);
  const { toast } = useToast();
  const inviteTeamMemberCallable = httpsCallable(functions, 'inviteTeamMemberToAgency');

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !/^\S+@\S+\.\S+$/.test(inviteEmail)) {
      toast({ title: "Invalid Email", description: "Please enter a valid email address.", variant: "destructive" });
      return;
    }
    
    setIsInviting(true);
    try {
      await inviteTeamMemberCallable({ agencyId, memberEmail: inviteEmail.trim(), role });
      toast({ title: "Invitation Sent", description: `An invitation for the '${role}' role has been sent to ${inviteEmail}.` });
      setInviteEmail("");
      setRole("member");
    } catch (error: any) {
      console.error("Error inviting team member:", error);
      toast({ title: "Invitation Failed", description: error.message || "Could not invite team member.", variant: "destructive" });
    } finally {
      setIsInviting(false);
    }
  };

  return (
    <Card id="invite-team-member-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Shield className="text-primary"/> Invite Team Member</CardTitle>
        <CardDescription>Add admins or members to help manage your agency.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="team-member-email">Email Address</Label>
            <div className="relative mt-1">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                  id="team-member-email"
                  type="email" 
                  placeholder="manager@example.com" 
                  className="pl-10"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  disabled={isInviting || disabled}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="team-member-role">Role</Label>
            <Select value={role} onValueChange={(value) => setRole(value as any)} disabled={isInviting || disabled}>
                <SelectTrigger id="team-member-role" className="mt-1">
                    <SelectValue placeholder="Select a role..." />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
            </Select>
          </div>
        </div>
        <Button onClick={handleInvite} disabled={isInviting || !inviteEmail.trim() || disabled}>
          {isInviting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
          Send Invite
        </Button>
      </CardContent>
    </Card>
  );
}
