
"use client";

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Users, Check, X, Percent } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Agency, Talent } from '@/types';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface TalentRosterCardProps {
  agency: Agency;
}

export function TalentRosterCard({ agency }: TalentRosterCardProps) {
  const { toast } = useToast();
  const [editingTalent, setEditingTalent] = useState<Talent | null>(null);
  const [newCommissionRate, setNewCommissionRate] = useState<number>(0);

  const handleUpdateCommission = async () => {
    if (!editingTalent) return;
    const rate = Number(newCommissionRate);
    if (isNaN(rate) || rate < 0 || rate > 100) {
      toast({ title: "Invalid Rate", description: "Commission must be between 0 and 100.", variant: "destructive" });
      return;
    }
    
    const updatedTalentArray = agency.talent.map(t => 
      t.userId === editingTalent.userId ? { ...t, commissionRate: rate } : t
    );

    const agencyDocRef = doc(db, "agencies", agency.id);
    try {
      await updateDoc(agencyDocRef, { talent: updatedTalentArray });
      toast({ title: "Commission Updated", description: `Commission for ${editingTalent.displayName} set to ${rate}%.`});
      setEditingTalent(null);
    } catch (error) {
      console.error("Error updating commission:", error);
      toast({title: "Update Failed", description: "Could not save commission change.", variant: "destructive"});
    }
  };

  const activeTalentCount = agency.talent.filter(t => t.status === 'active').length;

  return (
    <Card id="talent-roster-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Users className="text-primary"/> Talent Roster</CardTitle>
        <CardDescription>View your current roster of creators. ({activeTalentCount} active talents)</CardDescription>
      </CardHeader>
      <CardContent>
         {agency.talent && agency.talent.length > 0 ? (
          <Table>
            <TableHeader><TableRow><TableHead>Creator</TableHead><TableHead>Email</TableHead><TableHead>Status</TableHead><TableHead>Commission</TableHead></TableRow></TableHeader>
            <TableBody>
              {agency.talent.map(t => (
                <TableRow key={t.userId}>
                  <TableCell className="font-medium flex items-center gap-2">
                    <Avatar className="h-8 w-8"><AvatarFallback>{t.displayName ? t.displayName.charAt(0) : 'T'}</AvatarFallback></Avatar>
                    {t.displayName || 'N/A'}
                  </TableCell>
                  <TableCell>{t.email}</TableCell>
                  <TableCell><Badge variant={t.status === 'active' ? 'default' : 'secondary'} className={`capitalize ${t.status === 'active' ? 'bg-green-500' : ''}`}>{t.status}</Badge></TableCell>
                  <TableCell>
                    {editingTalent?.userId === t.userId ? (
                      <div className="flex items-center gap-2">
                         <div className="relative">
                          <Input type="number" value={newCommissionRate} onChange={(e) => setNewCommissionRate(Number(e.target.value))} className="w-20 pl-2 pr-6"/>
                          <Percent className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        </div>
                        <Button size="icon" className="h-8 w-8" onClick={handleUpdateCommission}><Check className="h-4 w-4"/></Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditingTalent(null)}><X className="h-4 w-4"/></Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span>{t.commissionRate ?? 0}%</span>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEditingTalent(t); setNewCommissionRate(t.commissionRate ?? 0); }}>
                          <Percent className="h-4 w-4"/>
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
         ) : <p className="text-center text-muted-foreground py-6">Your talent roster is empty. Invite some creators!</p>}
      </CardContent>
    </Card>
  );
}
