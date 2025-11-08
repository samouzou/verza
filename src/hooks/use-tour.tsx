
"use client";

import React, { createContext, useContext, useState, useCallback, ReactNode, useMemo } from 'react';
import type { Tour, TourStep } from '@/types';

interface TourContextType {
  activeTour: Tour | null;
  currentStepIndex: number;
  isTourActive: boolean;
  startTour: (tour: Tour, startIndex?: number) => void;
  stopTour: () => void;
  goToNextStep: () => void;
  goToPrevStep: () => void;
  currentStep: TourStep | null;
}

const TourContext = createContext<TourContextType | undefined>(undefined);

export const TourProvider = ({ children }: { children: ReactNode }) => {
  const [activeTour, setActiveTour] = useState<Tour | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  const isTourActive = useMemo(() => activeTour !== null, [activeTour]);
  const currentStep = useMemo(() => activeTour?.steps[currentStepIndex] || null, [activeTour, currentStepIndex]);

  const startTour = useCallback((tour: Tour, startIndex = 0) => {
    setActiveTour(tour);
    setCurrentStepIndex(startIndex);
  }, []);

  const stopTour = useCallback(() => {
    const tourToStop = activeTour;
    setActiveTour(null);
    setCurrentStepIndex(0);
    if (tourToStop?.onStop) {
      tourToStop.onStop();
    }
  }, [activeTour]);

  const goToNextStep = useCallback(() => {
    if (activeTour && currentStepIndex < activeTour.steps.length - 1) {
      setCurrentStepIndex(prev => prev + 1);
    } else {
      stopTour();
    }
  }, [activeTour, currentStepIndex, stopTour]);

  const goToPrevStep = useCallback(() => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(prev => prev - 1);
    }
  }, [currentStepIndex]);

  const value = {
    activeTour,
    currentStepIndex,
    isTourActive,
    currentStep,
    startTour,
    stopTour,
    goToNextStep,
    goToPrevStep,
  };

  return (
    <TourContext.Provider value={value}>
      {children}
    </TourContext.Provider>
  );
};

export const useTour = (): TourContextType => {
  const context = useContext(TourContext);
  if (context === undefined) {
    throw new Error('useTour must be used within a TourProvider');
  }
  return context;
};
