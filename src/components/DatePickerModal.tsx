import React, { useState } from 'react';
import { 
  format, 
  addMonths, 
  subMonths, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  isSameMonth, 
  isSameDay, 
  addDays, 
  eachDayOfInterval, 
  isToday,
  isAfter,
  startOfToday
} from 'date-fns';
import { ChevronLeft, ChevronRight, X, Calendar as CalendarIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

interface DatePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate: Date;
  onSelect: (date: Date) => void;
}

export default function DatePickerModal({ isOpen, onClose, selectedDate, onSelect }: DatePickerModalProps) {
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(selectedDate));
  const today = startOfToday();

  const handlePrevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const handleNextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart, { weekStartsOn: 1 }); // Start on Monday
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });

  const calendarDays = eachDayOfInterval({
    start: startDate,
    end: endDate,
  });

  const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const handleDateClick = (day: Date) => {
    if (isAfter(day, today)) return; // Optional: disable future dates
    onSelect(day);
    onClose();
  };

  const handleToday = () => {
    onSelect(today);
    onClose();
  };

  const handleYesterday = () => {
    onSelect(addDays(today, -1));
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100]"
          />
          
          {/* Modal Container */}
          <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-[101] px-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-md pointer-events-auto overflow-hidden border border-border"
            >
              {/* Header */}
              <div className="bg-ink text-white p-6 pb-4">
                <div className="flex justify-between items-center mb-6">
                  <div className="flex items-center gap-2">
                    <CalendarIcon size={20} className="text-accent" />
                    <h2 className="text-lg font-black uppercase tracking-widest">Select Date</h2>
                  </div>
                  <button 
                    onClick={onClose}
                    className="p-2 hover:bg-white/10 rounded-full transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="flex justify-between items-center">
                  <button 
                    onClick={handlePrevMonth}
                    className="p-2 hover:bg-white/10 rounded-xl transition-colors"
                  >
                    <ChevronLeft size={24} />
                  </button>
                  <div className="text-xl font-black tracking-tight">
                    {format(currentMonth, 'MMMM yyyy')}
                  </div>
                  <button 
                    onClick={handleNextMonth}
                    className="p-2 hover:bg-white/10 rounded-xl transition-colors"
                  >
                    <ChevronRight size={24} />
                  </button>
                </div>
              </div>

              {/* Shortcuts */}
              <div className="flex gap-2 p-4 bg-gray-50 border-b border-border">
                <button 
                  onClick={handleToday}
                  className="flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-white border border-border text-ink hover:border-accent transition-all active:scale-95 shadow-sm"
                >
                  Today
                </button>
                <button 
                  onClick={handleYesterday}
                  className="flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-white border border-border text-ink hover:border-accent transition-all active:scale-95 shadow-sm"
                >
                  Yesterday
                </button>
              </div>

              {/* Calendar Grid */}
              <div className="p-6">
                <div className="grid grid-cols-7 mb-4">
                  {weekDays.map(day => (
                    <div key={day} className="text-center text-[10px] font-black text-subtle uppercase tracking-widest">
                      {day}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7 gap-1">
                  {calendarDays.map((day, i) => {
                    const isSelected = isSameDay(day, selectedDate);
                    const isCurrentMonth = isSameMonth(day, currentMonth);
                    const isFuture = isAfter(day, today);
                    const dayIsToday = isToday(day);

                    return (
                      <button
                        key={day.toISOString()}
                        onClick={() => handleDateClick(day)}
                        disabled={isFuture}
                        className={cn(
                          "aspect-square flex items-center justify-center text-sm font-bold rounded-xl transition-all relative",
                          !isCurrentMonth && "text-subtle/30",
                          isCurrentMonth && !isSelected && !isFuture && "text-ink hover:bg-gray-100",
                          isSelected && "bg-accent text-white shadow-lg shadow-accent/20 scale-110 z-10",
                          isFuture && "text-subtle/20 cursor-not-allowed",
                          dayIsToday && !isSelected && "text-accent ring-1 ring-accent/30"
                        )}
                      >
                        {format(day, 'd')}
                        {dayIsToday && !isSelected && (
                          <div className="absolute bottom-1 w-1 h-1 bg-accent rounded-full" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
