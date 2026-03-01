
"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Users, ShieldCheck, User } from 'lucide-react';
import type { Agency, UserProfileFirestoreData } from '@/types';

interface TeamRosterCardProps {
  agency: Agency;
  liveProfiles: Record<string, UserProfileFirestoreData>;
}

export function TeamRosterCard({ agency, liveProfiles }: TeamRosterCardProps) {
  return (
    <Card id="team-roster-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Users className="text-primary"/> Agency Team</CardTitle>
        <CardDescription>Your agency's administrative members.</CardDescription>
      </CardHeader>
      <CardContent>
         {(agency.team && agency.team.length > 0) ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agency.team.map(t => {
                const profile = liveProfiles[t.userId];
                const displayName = profile?.displayName || t.displayName || 'N/A';
                const avatarUrl = profile?.avatarUrl || null;

                return (
                  <TableRow key={t.userId}>
                    <TableCell className="font-medium flex items-center gap-2">
                      <Avatar className="h-8 w-8">
                        {avatarUrl && <AvatarImage src={avatarUrl} />}
                        <AvatarFallback>{displayName.charAt(0)}</AvatarFallback>
                      </Avatar>
                      {displayName}
                    </TableCell>
                    <TableCell>{profile?.email || t.email}</TableCell>
                    <TableCell>
                      <Badge variant={t.role === 'admin' ? 'default' : 'secondary'} className={`capitalize ${t.role === 'admin' ? 'bg-primary/80' : ''}`}>
                         {t.role === 'admin' ? <ShieldCheck className="mr-1 h-3 w-3" /> : <User className="mr-1 h-3 w-3" />}
                         {t.role}
                      </Badge>
                    </TableCell>
                     <TableCell>
                       <Badge variant={t.status === 'active' ? 'default' : 'secondary'} className={`capitalize ${t.status === 'active' ? 'bg-green-500' : ''}`}>{t.status}</Badge>
                     </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
         ) : <p className="text-center text-muted-foreground py-6">You have not invited any team members yet.</p>}
      </CardContent>
    </Card>
  );
}
