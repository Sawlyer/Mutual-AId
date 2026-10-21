import { useState } from 'react'
import { ArrowLeft, ArrowRight, Check, CircleAlert, Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { demoAgents } from '@/services/demo-data'
import { generateDemoPlan } from '@/services/demo-planner'
import { useMissionsStore } from '@/stores/use-missions-store'
import type { MissionPriority, PlannedTaskInput } from '@/types/domain'

const priorities: { value: MissionPriority; label: string; description: string }[] = [
  { value: 'low', label: 'Basse', description: 'Peut attendre' },
  { value: 'medium', label: 'Normale', description: 'Priorité standard' },
  { value: 'high', label: 'Haute', description: 'À traiter rapidement' },
  { value: 'urgent', label: 'Urgente', description: 'À traiter en premier' },
]

type FormErrors = Partial<Record<'title' | 'objective' | 'maxAgents', string>>

export function MissionCreatePage() {
  const navigate = useNavigate()
  const createMission = useMissionsStore((state) => state.createMission)
  const [title, setTitle] = useState('')
  const [objective, setObjective] = useState('')
  const [requestedTasks, setRequestedTasks] = useState<string[]>([])
  const [taskInput, setTaskInput] = useState('')
  const [constraints, setConstraints] = useState('')
  const [priority, setPriority] = useState<MissionPriority>('medium')
  const [maxAgents, setMaxAgents] = useState(3)
  const [humanValidationRequired, setHumanValidationRequired] = useState(false)
  const [plan, setPlan] = useState<PlannedTaskInput[] | null>(null)
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitError, setSubmitError] = useState('')
  const [saving, setSaving] = useState(false)
  const [planAgentError, setPlanAgentError] = useState('')

  function addRequestedTask() {
    const value = taskInput.trim()
    if (!value) return
    setRequestedTasks((current) => [...current, value])
    setTaskInput('')
  }

  function generatePlan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextErrors: FormErrors = {}
    if (!title.trim()) nextErrors.title = 'Saisissez un nom de mission.'
    if (!objective.trim()) nextErrors.objective = 'Décrivez le résultat attendu.'
    if (maxAgents < 1 || maxAgents > demoAgents.length) nextErrors.maxAgents = `Choisissez entre 1 et ${demoAgents.length} agents.`
    setErrors(nextErrors)
    setSubmitError('')
    if (Object.keys(nextErrors).length) return
    setPlan(generateDemoPlan({ objective: objective.trim(), requestedTasks, maxAgents }))
  }

  function updatePlanTask(draftId: string, updates: Partial<PlannedTaskInput>) {
    setPlan((current) => current?.map((task) => task.draftId === draftId ? { ...task, ...updates } : task) ?? null)
  }

  async function confirmPlan() {
    if (!plan) return
    if (!title.trim()) {
      setErrors((current) => ({ ...current, title: 'Le titre de la mission est requis.' }))
      return
    }
    setSaving(true)
    setSubmitError('')
    try {
      const mission = await createMission({
        title: title.trim(), objective: objective.trim(), priority,
        constraints: constraints.trim(), requestedTasks, maxAgents, humanValidationRequired,
        planningMethod: requestedTasks.length ? 'user-defined' : 'demo-template', tasks: plan,
      })
      navigate(`/missions/${mission.id}`)
    } catch {
      setSubmitError('La mission n’a pas pu être enregistrée. Réessayez.')
      setSaving(false)
    }
  }

  const previewTasks = plan ?? []
  const parallelTasks = previewTasks.filter((task) => task.parallelGroupId)

  return <div className="mx-auto max-w-4xl space-y-6">
    <Link to="/missions" className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"><ArrowLeft aria-hidden="true" className="size-3.5" />Retour aux missions</Link>
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm text-muted-foreground">Orchestration</p><h2 className="mt-1 font-heading text-2xl font-semibold tracking-tight">Nouvelle mission</h2><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Décrivez votre objectif, puis vérifiez le plan de démonstration avant de l’ajouter.</p></div><Badge variant="outline" className="gap-1.5 border-amber-500/20 bg-amber-500/5 text-amber-700 dark:text-amber-300"><Sparkles aria-hidden="true" className="size-3" />Plan déterministe · sans IA</Badge></div>

    <div className="flex items-center gap-3 text-xs"><span className={`grid size-7 place-items-center rounded-full ${plan ? 'bg-muted text-muted-foreground' : 'bg-primary text-primary-foreground'}`}>{plan ? <Check aria-hidden="true" className="size-3.5" /> : '1'}</span><span className={!plan ? 'font-medium' : 'text-muted-foreground'}>Définir la mission</span><span className="h-px flex-1 bg-border" /><span className={`grid size-7 place-items-center rounded-full ${plan ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>2</span><span className={plan ? 'font-medium' : 'text-muted-foreground'}>Vérifier le plan</span></div>

    {!plan ? <Card><CardHeader><CardTitle>Objectif et paramètres</CardTitle><CardDescription>Les informations restent dans le stockage local de cette démo.</CardDescription></CardHeader><CardContent><form onSubmit={generatePlan} className="space-y-6" noValidate>
      {submitError && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{submitError}</p>}
      <div className="space-y-2"><Label htmlFor="mission-title">Nom de la mission</Label><Input id="mission-title" required maxLength={140} value={title} aria-invalid={Boolean(errors.title)} aria-describedby={errors.title ? 'mission-title-error' : undefined} onChange={(event) => { setTitle(event.target.value); setErrors((current) => ({ ...current, title: undefined })) }} placeholder="Ex. Analyser les tendances du marché" />{errors.title && <p id="mission-title-error" role="alert" className="text-xs text-destructive">{errors.title}</p>}</div>
      <div className="space-y-2"><Label htmlFor="mission-objective">Objectif</Label><Textarea id="mission-objective" required maxLength={3000} rows={7} className="min-h-40 resize-y" value={objective} aria-invalid={Boolean(errors.objective)} aria-describedby={errors.objective ? 'mission-objective-error' : 'objective-hint'} onChange={(event) => { setObjective(event.target.value); setErrors((current) => ({ ...current, objective: undefined })) }} placeholder="Quel problème résoudre ? Quel résultat livrer ? Ajoutez les éléments de contexte utiles…" /><p id="objective-hint" className="text-[11px] text-muted-foreground">Un objectif précis aide à préparer des tâches plus faciles à vérifier.</p>{errors.objective && <p id="mission-objective-error" role="alert" className="text-xs text-destructive">{errors.objective}</p>}</div>

      <fieldset className="space-y-3"><div><legend className="text-sm font-medium">Tâches imposées <span className="font-normal text-muted-foreground">(facultatif)</span></legend><p className="mt-1 text-xs text-muted-foreground">Ajoutez les étapes qui doivent apparaître dans le plan.</p></div><div className="flex gap-2"><Input aria-label="Nouvelle tâche imposée" maxLength={120} value={taskInput} onChange={(event) => setTaskInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addRequestedTask() } }} placeholder="Ex. Ajouter les tests de régression" /><Button type="button" variant="outline" onClick={addRequestedTask} disabled={!taskInput.trim()}><Plus aria-hidden="true" />Ajouter</Button></div>{requestedTasks.length > 0 && <ul className="space-y-2">{requestedTasks.map((task, index) => <li key={`${task}-${index}`} className="flex items-center gap-2 rounded-lg border border-border/80 px-3 py-2"><span className="grid size-6 shrink-0 place-items-center rounded-md bg-muted text-[10px] font-medium tabular-nums text-muted-foreground">{index + 1}</span><span className="min-w-0 flex-1 text-xs">{task}</span><button type="button" aria-label={`Retirer la tâche ${task}`} onClick={() => setRequestedTasks((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Trash2 aria-hidden="true" className="size-3.5" /></button></li>)}</ul>}</fieldset>

      <div className="space-y-2"><Label htmlFor="mission-constraints">Contraintes et instructions supplémentaires <span className="font-normal text-muted-foreground">(facultatif)</span></Label><Textarea id="mission-constraints" rows={3} maxLength={1500} value={constraints} onChange={(event) => setConstraints(event.target.value)} placeholder="Ex. Utiliser uniquement les données fournies, citer les sources, respecter le format…" /></div>

      <fieldset className="space-y-3"><legend className="text-sm font-medium">Priorité</legend><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{priorities.map((item) => <button key={item.value} type="button" aria-pressed={priority === item.value} onClick={() => setPriority(item.value)} className={`rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${priority === item.value ? 'border-primary/50 bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:bg-muted'}`}><span className="block text-xs font-medium">{item.label}</span><span className="mt-1 block text-[10px] opacity-80">{item.description}</span></button>)}</div></fieldset>

      <div className="grid gap-5 border-t border-border pt-5 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="mission-max-agents">Nombre maximal d’agents</Label><select id="mission-max-agents" value={maxAgents} aria-invalid={Boolean(errors.maxAgents)} onChange={(event) => { setMaxAgents(Number(event.target.value)); setErrors((current) => ({ ...current, maxAgents: undefined })) }} className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{demoAgents.map((_, index) => <option key={index + 1} value={index + 1}>{index + 1} agent{index ? 's' : ''}</option>)}</select>{errors.maxAgents && <p role="alert" className="text-xs text-destructive">{errors.maxAgents}</p>}<p className="text-[11px] text-muted-foreground">Le plan proposera au plus {maxAgents} agent{maxAgents > 1 ? 's' : ''} distinct{maxAgents > 1 ? 's' : ''}.</p></div>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3"><input type="checkbox" checked={humanValidationRequired} onChange={(event) => setHumanValidationRequired(event.target.checked)} className="mt-0.5 size-4 accent-primary" /><span><span className="block text-xs font-medium">Validation humaine</span><span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">Demander une validation avant les actions importantes et la remise des livrables.</span></span></label></div>

      <div className="flex justify-end border-t border-border pt-4"><Button type="submit">Générer un aperçu<Sparkles aria-hidden="true" /></Button></div>
    </form></CardContent></Card> : <div className="space-y-4">
      <Card><CardHeader className="flex-row items-start justify-between gap-3"><div><CardTitle>Aperçu du plan</CardTitle><CardDescription className="mt-1">Modèle de démonstration à règles fixes. Aucun modèle IA n’est appelé.</CardDescription></div><Button type="button" variant="outline" size="sm" onClick={() => setPlan(null)}><RotateCcw aria-hidden="true" />Modifier la demande</Button></CardHeader><CardContent className="space-y-5">
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-800 dark:text-amber-200"><span className="font-semibold">Stratégie de repli déterministe.</span> {requestedTasks.length ? maxAgents > 1 ? 'Le plan reprend les tâches imposées comme étapes indépendantes, donc parallélisables.' : 'Les tâches imposées restent indépendantes, mais le plafond d’un agent implique une exécution séquentielle.' : 'Le modèle applique une séquence fixe : cadrage, réalisation, vérification.'} Vérifiez et modifiez chaque proposition avant confirmation.</div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"><div className="space-y-2"><Label htmlFor="plan-title">Titre de mission</Label><Input id="plan-title" maxLength={140} value={title} aria-invalid={Boolean(errors.title)} onChange={(event) => { setTitle(event.target.value); setErrors((current) => ({ ...current, title: event.target.value.trim() ? undefined : 'Le titre de la mission est requis.' })) }} />{errors.title && <p role="alert" className="text-xs text-destructive">{errors.title}</p>}</div><div className="space-y-2"><span className="block text-xs font-medium">Priorité</span><Badge variant="outline" className="h-9 px-3">{priorities.find((item) => item.value === priority)?.label}</Badge></div></div>
        <div className="space-y-3">{previewTasks.map((task, index) => <article key={task.draftId} className="rounded-xl border border-border p-4"><div className="mb-3 flex items-center justify-between gap-3"><div className="flex items-center gap-2"><span className="grid size-6 place-items-center rounded-md bg-muted text-[10px] font-semibold text-muted-foreground">{index + 1}</span><h3 className="text-xs font-semibold">Sous-tâche {index + 1}</h3></div>{task.parallelGroupId && <Badge variant="outline" className="h-5 gap-1 text-[10px] text-sky-700 dark:text-sky-300"><span className="size-1.5 rounded-full bg-sky-500" />Parallélisable</Badge>}</div><div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]"><div className="space-y-2"><Label htmlFor={`${task.draftId}-title`} className="text-[11px]">Titre</Label><Input id={`${task.draftId}-title`} value={task.title} maxLength={140} onChange={(event) => updatePlanTask(task.draftId, { title: event.target.value })} /><Label htmlFor={`${task.draftId}-description`} className="text-[11px]">Instructions de la tâche</Label><Textarea id={`${task.draftId}-description`} rows={2} maxLength={1000} value={task.description} onChange={(event) => updatePlanTask(task.draftId, { description: event.target.value })} /></div><div className="space-y-3"><div className="space-y-2"><Label htmlFor={`${task.draftId}-agent`} className="text-[11px]">Agent proposé</Label><select id={`${task.draftId}-agent`} value={task.assignedAgentId ?? ''} onChange={(event) => { const agentId = event.target.value || null; const otherAgents = new Set(plan?.filter((item) => item.draftId !== task.draftId).map((item) => item.assignedAgentId).filter((id): id is string => Boolean(id))); if (agentId && !otherAgents.has(agentId) && otherAgents.size >= maxAgents) { setPlanAgentError(`Le maximum de ${maxAgents} agent${maxAgents > 1 ? 's' : ''} est déjà atteint.`); return } setPlanAgentError(''); updatePlanTask(task.draftId, { assignedAgentId: agentId }) }} className="flex h-9 w-full rounded-lg border border-input bg-background px-2.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="">À déterminer</option>{demoAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.role}</option>)}</select></div><div><p className="text-[11px] font-medium">Compétences requises</p><div className="mt-1.5 flex flex-wrap gap-1">{task.requiredSkills.map((skill) => <Badge key={skill} variant="secondary" className="h-5 px-1.5 text-[10px]">{skill}</Badge>)}</div></div><div><p className="text-[11px] font-medium">Dépendances</p><p className="mt-1 text-[10px] text-muted-foreground">{task.dependencies.length ? task.dependencies.map((dependency) => previewTasks.find((item) => item.draftId === dependency)?.title ?? dependency).join(' · ') : 'Aucune · démarrage immédiat'}</p></div></div></div></article>)}</div>
        {previewTasks.some((task) => !task.title.trim() || !task.description.trim()) && <p role="alert" className="text-xs text-destructive">Chaque tâche doit avoir un titre et des instructions avant confirmation.</p>}
        {parallelTasks.length > 1 && <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3"><p className="text-xs font-semibold text-sky-800 dark:text-sky-200">Tâches pouvant démarrer en parallèle</p><ul className="mt-2 flex flex-wrap gap-2">{parallelTasks.map((task) => <li key={task.draftId} className="rounded-md bg-background px-2 py-1 text-[10px]">{task.title}</li>)}</ul></div>}
        {parallelTasks.length <= 1 && <p className="text-xs text-muted-foreground">Aucune tâche parallèle détectée avec ce modèle.</p>}
        <div className="grid gap-2 rounded-lg bg-muted/50 p-3 text-xs sm:grid-cols-2"><p><span className="text-muted-foreground">Agents maximum :</span> {maxAgents}</p><p><span className="text-muted-foreground">Validation humaine :</span> {humanValidationRequired ? 'requise' : 'non requise'}</p>{constraints && <p className="sm:col-span-2"><span className="text-muted-foreground">Consignes globales :</span> {constraints}</p>}</div>
        {planAgentError && <p role="alert" className="text-xs text-destructive">{planAgentError}</p>}
        {submitError && <p role="alert" className="flex items-center gap-2 text-xs text-destructive"><CircleAlert aria-hidden="true" className="size-4" />{submitError}</p>}
        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-between"><Button type="button" variant="outline" onClick={() => setPlan(null)}>Retour à la demande</Button><Button type="button" disabled={saving || !title.trim() || previewTasks.some((task) => !task.title.trim() || !task.description.trim())} onClick={confirmPlan}>{saving ? 'Enregistrement…' : 'Confirmer le plan'}<ArrowRight aria-hidden="true" /></Button></div>
      </CardContent></Card>
    </div>}
  </div>
}
