
"use client";

import { useState } from "react";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { Loader2, MessageSquare } from "lucide-react";
import { SidebarMenuButton } from "@/components/ui/sidebar";

export function SupportDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) {
      toast({ 
        title: "Required fields", 
        description: "Please fill in all fields.", 
        variant: "destructive" 
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const submitFeedbackCallable = httpsCallable(functions, 'submitFeedback');
      await submitFeedbackCallable({ subject, message });
      
      toast({ 
        title: "Feedback sent!", 
        description: "We've received your message and will get back to you soon." 
      });
      setSubject("");
      setMessage("");
      setIsOpen(false);
    } catch (error: any) {
      console.error("Error submitting feedback:", error);
      toast({ 
        title: "Submission failed", 
        description: error.message || "Could not send feedback.", 
        variant: "destructive" 
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <SidebarMenuButton tooltip="Help & Feedback">
          <MessageSquare className="h-5 w-5" />
          <span>Help & Feedback</span>
        </SidebarMenuButton>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Help & Feedback</DialogTitle>
          <DialogDescription>
            Have a question or a suggestion? Send it directly to our support team.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="subject">Subject</Label>
            <Input 
              id="subject" 
              value={subject} 
              onChange={(e) => setSubject(e.target.value)} 
              placeholder="How can we help?" 
              disabled={isSubmitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="message">Message</Label>
            <Textarea 
              id="message" 
              value={message} 
              onChange={(e) => setMessage(e.target.value)} 
              placeholder="Describe your question or feedback..." 
              rows={5}
              disabled={isSubmitting}
            />
          </div>
          <DialogFooter>
            <Button 
              type="submit" 
              disabled={isSubmitting || !subject.trim() || !message.trim()}
            >
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Send Message
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
