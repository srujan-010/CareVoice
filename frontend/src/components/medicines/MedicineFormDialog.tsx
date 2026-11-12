'use client';

import React, { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input, SelectNative, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ApiClientError, apiRequest } from '@/lib/api';
import type {
  AssociatedMeal,
  FamilyMember,
  FoodInstruction,
  MedicineFrequency,
} from '@/types';

export interface MedicineSlotForm {
  slotLabel: string;
  timeOfDay: string;
  associatedMeal: AssociatedMeal;
  customMealName?: string;
  foodInstruction: FoodInstruction;
  customFoodInstruction?: string;
  mealReminderOffsetMinutes: number | null;
  medicineReminderOffsetMinutes: number;
  confirmationOffsetMinutes: number | null;
  daysOfWeek?: number[];
  intervalDays?: number;
}

export interface MedicineRecord {
  id: string;
  _id?: string;
  familyMemberId:
    | string
    | { _id: string; fullName: string; preferredLanguage?: string; timezone?: string };
  name: string;
  dosage: string;
  prescribedInstructions: string;
  foodInstruction: FoodInstruction;
  customFoodInstruction?: string;
  associatedMeal: AssociatedMeal;
  customMealName?: string;
  startDate: string;
  endDate?: string;
  frequency: MedicineFrequency;
  scheduledTimes: MedicineSlotForm[];
  prescribingDoctor?: string;
  notes?: string;
  isActive: boolean;
}

function presetSlotsForFrequency(freq: MedicineFrequency): MedicineSlotForm[] {
  switch (freq) {
    case 'TWICE_DAILY':
      return [
        {
          slotLabel: 'Morning Dose',
          timeOfDay: '08:00',
          associatedMeal: 'BREAKFAST',
          foodInstruction: 'AFTER_FOOD',
          mealReminderOffsetMinutes: -15,
          medicineReminderOffsetMinutes: 0,
          confirmationOffsetMinutes: 20,
        },
        {
          slotLabel: 'Night Dose',
          timeOfDay: '20:00',
          associatedMeal: 'DINNER',
          foodInstruction: 'AFTER_FOOD',
          mealReminderOffsetMinutes: -15,
          medicineReminderOffsetMinutes: 0,
          confirmationOffsetMinutes: 20,
        },
      ];
    case 'THREE_TIMES_DAILY':
      return [
        {
          slotLabel: 'Morning Before Breakfast',
          timeOfDay: '07:30',
          associatedMeal: 'BREAKFAST',
          foodInstruction: 'BEFORE_FOOD',
          mealReminderOffsetMinutes: -15,
          medicineReminderOffsetMinutes: 0,
          confirmationOffsetMinutes: 20,
        },
        {
          slotLabel: 'Afternoon Before Lunch',
          timeOfDay: '13:00',
          associatedMeal: 'LUNCH',
          foodInstruction: 'BEFORE_FOOD',
          mealReminderOffsetMinutes: -15,
          medicineReminderOffsetMinutes: 0,
          confirmationOffsetMinutes: 20,
        },
        {
          slotLabel: 'Evening Before Dinner',
          timeOfDay: '19:30',
          associatedMeal: 'DINNER',
          foodInstruction: 'BEFORE_FOOD',
          mealReminderOffsetMinutes: -15,
          medicineReminderOffsetMinutes: 0,
          confirmationOffsetMinutes: 20,
        },
      ];
    case 'FOUR_TIMES_DAILY':
      return [
        {
          slotLabel: 'Morning',
          timeOfDay: '07:30',
          associatedMeal: 'BREAKFAST',
          foodInstruction: 'BEFORE_FOOD',
          mealReminderOffsetMinutes: -15,
          medicineReminderOffsetMinutes: 0,
          confirmationOffsetMinutes: 20,
        },
        {
          slotLabel: 'Midday',
          timeOfDay: '12:30',
          associatedMeal: 'LUNCH',
          foodInstruction: 'AFTER_FOOD',
          mealReminderOffsetMinutes: -15,
          medicineReminderOffsetMinutes: 0,
          confirmationOffsetMinutes: 20,
        },
        {
          slotLabel: 'Evening',
          timeOfDay: '17:30',
          associatedMeal: 'CUSTOM',
          customMealName: 'Evening Snack',
          foodInstruction: 'WITH_FOOD',
          mealReminderOffsetMinutes: -10,
          medicineReminderOffsetMinutes: 0,
          confirmationOffsetMinutes: 20,
        },
        {
          slotLabel: 'Bedtime',
          timeOfDay: '21:30',
          associatedMeal: 'DINNER',
          foodInstruction: 'AFTER_FOOD',
          mealReminderOffsetMinutes: -15,
          medicineReminderOffsetMinutes: 0,
          confirmationOffsetMinutes: 20,
        },
      ];
    default:
      return [
        {
          slotLabel: 'Morning Dose',
          timeOfDay: '08:00',
          associatedMeal: 'BREAKFAST',
          foodInstruction: 'AFTER_FOOD',
          mealReminderOffsetMinutes: -15,
          medicineReminderOffsetMinutes: 0,
          confirmationOffsetMinutes: 20,
        },
      ];
  }
}

interface MedicineFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: FamilyMember[];
  medicine?: MedicineRecord | null;
  onSaved: () => void;
}

export function MedicineFormDialog({
  open,
  onOpenChange,
  members,
  medicine,
  onSaved,
}: MedicineFormDialogProps) {
  const isEdit = Boolean(medicine);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [familyMemberId, setFamilyMemberId] = useState('');
  const [name, setName] = useState('');
  const [dosage, setDosage] = useState('');
  const [prescribedInstructions, setPrescribedInstructions] = useState('');
  const [foodInstruction, setFoodInstruction] = useState<FoodInstruction>('BEFORE_FOOD');
  const [customFoodInstruction, setCustomFoodInstruction] = useState('');
  const [associatedMeal, setAssociatedMeal] = useState<AssociatedMeal>('BREAKFAST');
  const [customMealName, setCustomMealName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [frequency, setFrequency] = useState<MedicineFrequency>('ONCE_DAILY');
  const [scheduledTimes, setScheduledTimes] = useState<MedicineSlotForm[]>(
    presetSlotsForFrequency('ONCE_DAILY')
  );
  const [prescribingDoctor, setPrescribingDoctor] = useState('');
  const [notes, setNotes] = useState('');
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    const todayIso = new Intl.DateTimeFormat('en-CA').format(new Date());
    if (medicine) {
      const mId =
        typeof medicine.familyMemberId === 'string'
          ? medicine.familyMemberId
          : medicine.familyMemberId?._id || members[0]?.id || '';
      setFamilyMemberId(mId);
      setName(medicine.name);
      setDosage(medicine.dosage);
      setPrescribedInstructions(medicine.prescribedInstructions);
      setFoodInstruction(medicine.foodInstruction);
      setCustomFoodInstruction(medicine.customFoodInstruction || '');
      setAssociatedMeal(medicine.associatedMeal);
      setCustomMealName(medicine.customMealName || '');
      setStartDate(medicine.startDate ? medicine.startDate.slice(0, 10) : todayIso);
      setEndDate(medicine.endDate ? medicine.endDate.slice(0, 10) : '');
      setFrequency(medicine.frequency);
      setScheduledTimes(
        medicine.scheduledTimes?.length
          ? medicine.scheduledTimes
          : presetSlotsForFrequency(medicine.frequency)
      );
      setPrescribingDoctor(medicine.prescribingDoctor || '');
      setNotes(medicine.notes || '');
      setIsActive(medicine.isActive);
    } else {
      setFamilyMemberId(members[0]?.id || '');
      setName('');
      setDosage('');
      setPrescribedInstructions('Take with warm water as prescribed');
      setFoodInstruction('BEFORE_FOOD');
      setCustomFoodInstruction('');
      setAssociatedMeal('BREAKFAST');
      setCustomMealName('');
      setStartDate(todayIso);
      setEndDate('');
      setFrequency('ONCE_DAILY');
      setScheduledTimes(presetSlotsForFrequency('ONCE_DAILY'));
      setPrescribingDoctor('');
      setNotes('');
      setIsActive(true);
    }
    setError(null);
  }, [medicine, members, open]);

  const handleFrequencyChange = (nextFreq: MedicineFrequency) => {
    setFrequency(nextFreq);
    if (!isEdit) {
      setScheduledTimes(presetSlotsForFrequency(nextFreq));
    }
  };

  const updateSlot = (idx: number, patch: Partial<MedicineSlotForm>) => {
    setScheduledTimes((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const addSlot = () => {
    setScheduledTimes((prev) => [
      ...prev,
      {
        slotLabel: `Dose ${prev.length + 1}`,
        timeOfDay: '12:00',
        associatedMeal: 'LUNCH',
        foodInstruction,
        mealReminderOffsetMinutes: -15,
        medicineReminderOffsetMinutes: 0,
        confirmationOffsetMinutes: 20,
      },
    ]);
  };

  const removeSlot = (idx: number) => {
    if (scheduledTimes.length <= 1) return;
    setScheduledTimes((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const payload = {
      familyMemberId,
      name: name.trim(),
      dosage: dosage.trim(),
      prescribedInstructions: prescribedInstructions.trim(),
      foodInstruction,
      customFoodInstruction:
        foodInstruction === 'CUSTOM' ? customFoodInstruction.trim() : undefined,
      associatedMeal,
      customMealName: associatedMeal === 'CUSTOM' ? customMealName.trim() : undefined,
      startDate: new Date(`${startDate}T00:00:00.000Z`).toISOString(),
      endDate: endDate
        ? new Date(`${endDate}T23:59:59.000Z`).toISOString()
        : isEdit
          ? null
          : undefined,
      frequency,
      scheduledTimes: scheduledTimes.map((s) => ({
        ...s,
        intervalDays: frequency === 'ALTERNATE_DAYS' ? 2 : s.intervalDays,
      })),
      prescribingDoctor: prescribingDoctor.trim() || undefined,
      notes: notes.trim() || undefined,
      isActive,
    };

    try {
      if (isEdit && medicine) {
        await apiRequest(`/medicines/${medicine.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await apiRequest('/medicines', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Unable to save medicine.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Edit Prescription & Dose Slots' : 'Add Medicine & Multi-Dose Schedule'}
          </DialogTitle>
          <DialogDescription>
            Each dose time gets its own independent meal reminder, medicine call, and confirmation
            tracking.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs sm:text-sm font-medium text-rose-700">
            {error}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="rounded-2xl border border-sky-100 bg-sky-50/40 p-4 space-y-3.5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-blue-700">
              Prescription Information
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Assigned Family Member *
                </label>
                <SelectNative
                  required
                  value={familyMemberId}
                  onChange={(e) => setFamilyMemberId(e.target.value)}
                >
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.fullName} ({m.relationship})
                    </option>
                  ))}
                </SelectNative>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Prescribing Doctor (optional)
                </label>
                <Input
                  placeholder="Dr. Rao (Cardiology)"
                  value={prescribingDoctor}
                  onChange={(e) => setPrescribingDoctor(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Medicine Name *
                </label>
                <Input
                  required
                  placeholder="Metformin SR"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Dosage *</label>
                <Input
                  required
                  placeholder="500 mg (1 tablet)"
                  value={dosage}
                  onChange={(e) => setDosage(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Frequency *
                </label>
                <SelectNative
                  value={frequency}
                  onChange={(e) => handleFrequencyChange(e.target.value as MedicineFrequency)}
                >
                  <option value="ONCE_DAILY">Once Daily</option>
                  <option value="TWICE_DAILY">Twice Daily</option>
                  <option value="THREE_TIMES_DAILY">Three Times Daily</option>
                  <option value="FOUR_TIMES_DAILY">Four Times Daily</option>
                  <option value="WEEKLY">Weekly</option>
                  <option value="ALTERNATE_DAYS">Alternate Days</option>
                  <option value="CUSTOM">Custom Schedule</option>
                </SelectNative>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">
                    Start Date *
                  </label>
                  <Input
                    type="date"
                    required
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">
                    End Date (optional)
                  </label>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Default Food Rule *
                </label>
                <SelectNative
                  value={foodInstruction}
                  onChange={(e) => setFoodInstruction(e.target.value as FoodInstruction)}
                >
                  <option value="BEFORE_FOOD">Before Food</option>
                  <option value="AFTER_FOOD">After Food</option>
                  <option value="WITH_FOOD">With Food</option>
                  <option value="NO_FOOD_RESTRICTION">No Food Restriction</option>
                  <option value="CUSTOM">Custom Doctor Instructions</option>
                </SelectNative>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Default Associated Meal *
                </label>
                <SelectNative
                  value={associatedMeal}
                  onChange={(e) => setAssociatedMeal(e.target.value as AssociatedMeal)}
                >
                  <option value="BREAKFAST">Breakfast</option>
                  <option value="LUNCH">Lunch</option>
                  <option value="DINNER">Dinner</option>
                  <option value="CUSTOM">Custom Meal</option>
                </SelectNative>
              </div>
            </div>

            {foodInstruction === 'CUSTOM' ? (
              <Input
                required
                placeholder="Enter custom doctor food instruction..."
                value={customFoodInstruction}
                onChange={(e) => setCustomFoodInstruction(e.target.value)}
              />
            ) : null}

            {associatedMeal === 'CUSTOM' ? (
              <Input
                required
                placeholder="Enter custom meal name (e.g., Evening Tiffin)..."
                value={customMealName}
                onChange={(e) => setCustomMealName(e.target.value)}
              />
            ) : null}

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Prescribed Instructions *
              </label>
              <Input
                required
                placeholder="Take 1 tablet before meal with a full glass of water."
                value={prescribedInstructions}
                onChange={(e) => setPrescribedInstructions(e.target.value)}
              />
            </div>
          </div>

          {/* Individual Dose Slots */}
          <div className="rounded-2xl border border-sky-100 bg-sky-50/40 p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="min-w-0">
                <h4 className="text-xs font-bold uppercase tracking-wider text-blue-700">
                  Individual Dose Slots ({scheduledTimes.length})
                </h4>
                <p className="text-[11px] text-slate-500">
                  Every slot schedules separate meal reminders, medicine reminders &amp; confirmation
                  calls.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={addSlot}
                className="w-full sm:w-auto shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Slot
              </Button>
            </div>

            <div className="space-y-3">
              {scheduledTimes.map((slot, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-sky-200 bg-white p-3.5 space-y-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-blue-700">Dose #{idx + 1}</span>
                    {scheduledTimes.length > 1 ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => removeSlot(idx)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                      </Button>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-4 gap-2.5">
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                        Slot Label
                      </label>
                      <Input
                        required
                        value={slot.slotLabel}
                        onChange={(e) => updateSlot(idx, { slotLabel: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                        Time (Patient TZ)
                      </label>
                      <Input
                        type="time"
                        required
                        value={slot.timeOfDay}
                        onChange={(e) => updateSlot(idx, { timeOfDay: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                        Meal
                      </label>
                      <SelectNative
                        value={slot.associatedMeal}
                        onChange={(e) =>
                          updateSlot(idx, { associatedMeal: e.target.value as AssociatedMeal })
                        }
                      >
                        <option value="BREAKFAST">Breakfast</option>
                        <option value="LUNCH">Lunch</option>
                        <option value="DINNER">Dinner</option>
                        <option value="CUSTOM">Custom</option>
                      </SelectNative>
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                        Food Timing
                      </label>
                      <SelectNative
                        value={slot.foodInstruction}
                        onChange={(e) =>
                          updateSlot(idx, { foodInstruction: e.target.value as FoodInstruction })
                        }
                      >
                        <option value="BEFORE_FOOD">Before Food</option>
                        <option value="AFTER_FOOD">After Food</option>
                        <option value="WITH_FOOD">With Food</option>
                        <option value="NO_FOOD_RESTRICTION">No Restriction</option>
                        <option value="CUSTOM">Custom</option>
                      </SelectNative>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                        Meal Reminder Offset (min)
                      </label>
                      <Input
                        type="number"
                        min={-120}
                        max={60}
                        value={slot.mealReminderOffsetMinutes ?? -15}
                        onChange={(e) =>
                          updateSlot(idx, {
                            mealReminderOffsetMinutes:
                              e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                        Medicine Call Offset (min)
                      </label>
                      <Input
                        type="number"
                        min={-60}
                        max={60}
                        value={slot.medicineReminderOffsetMinutes}
                        onChange={(e) =>
                          updateSlot(idx, {
                            medicineReminderOffsetMinutes: Number(e.target.value),
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                        Confirmation Call Offset (+min)
                      </label>
                      <Input
                        type="number"
                        min={5}
                        max={180}
                        value={slot.confirmationOffsetMinutes ?? 20}
                        onChange={(e) =>
                          updateSlot(idx, {
                            confirmationOffsetMinutes:
                              e.target.value === '' ? null : Number(e.target.value),
                          })
                        }
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
            <Textarea
              placeholder="Optional caregiver notes..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <label className="flex items-center justify-between rounded-xl border border-sky-100 bg-sky-50/40 px-4 py-3 text-xs font-semibold text-slate-700">
              <span>Prescription Active (generate daily doses)</span>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </label>
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 sm:gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
              {submitting ? 'Saving & Generating Doses...' : isEdit ? 'Save Medicine' : 'Create Medicine'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

