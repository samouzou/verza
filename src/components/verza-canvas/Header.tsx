import { Users, Share2, Sun, Moon } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useTheme } from "next-themes"; // Assuming next-themes is installed for theme toggling
import { useEffect, useState } from 'react';

interface HeaderProps {
  title: string;
}

export function Header({ title }: HeaderProps) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  return (
    <header className="flex items-center justify-between p-4 border-b bg-card sticky top-0 z-10">
      <h1 className="text-xl font-semibold font-headline">{title}</h1>
      <div className="flex items-center gap-4">
        <div className="flex -space-x-2">
          <Avatar className="border-2 border-background h-8 w-8">
            <AvatarImage src="https://placehold.co/32x32.png?text=U1" alt="User 1" data-ai-hint="user avatar" />
            <AvatarFallback>U1</AvatarFallback>
          </Avatar>
          <Avatar className="border-2 border-background h-8 w-8">
            <AvatarImage src="https://placehold.co/32x32.png?text=U2" alt="User 2" data-ai-hint="user avatar" />
            <AvatarFallback>U2</AvatarFallback>
          </Avatar>
          <Avatar className="border-2 border-background h-8 w-8">
            <AvatarFallback>+3</AvatarFallback>
          </Avatar>
        </div>
        <Button variant="outline" size="sm">
          <Share2 className="mr-2 h-4 w-4" />
          Share
        </Button>
        {mounted && (
          <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme">
            {theme === 'light' ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
          </Button>
        )}
      </div>
    </header>
  );
}
