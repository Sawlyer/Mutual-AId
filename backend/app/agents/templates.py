from dataclasses import dataclass

from app.agents.models import AgentCapability


@dataclass(frozen=True)
class AgentSkillTemplate:
    name: str
    description: str
    instructions: str


@dataclass(frozen=True)
class AgentTemplate:
    id: str
    name: str
    domain: str
    description: str
    instructions: str
    capability: AgentCapability
    skills: tuple[AgentSkillTemplate, ...]
    version: int = 2


TEMPLATES: dict[str, AgentTemplate] = {
    "wellness_planning": AgentTemplate(
        id="wellness-organizer-v1",
        name="Conseiller habitudes santé",
        domain="wellness",
        description="Aide à organiser des habitudes de bien-être à partir des informations autorisées par la personne.",
        instructions=(
            "Aide à organiser des habitudes générales de bien-être et des routines réalistes. "
            "Ne pose aucun diagnostic, ne prescris aucun traitement et ne présente pas une inférence comme un fait médical. "
            "Utilise uniquement les informations explicitement fournies ou accessibles avec autorisation. "
            "Demande une précision lorsque les préférences ou contraintes sont inconnues."
        ),
        capability=AgentCapability(id="wellness_planning", label="Organisation du bien-être", template_id="wellness-organizer-v1"),
        skills=(AgentSkillTemplate(
            name="Organisation de routines bien-être",
            description="Transformer les objectifs en habitudes réalistes et prudentes.",
            instructions=(
                "Aide à découper un objectif général de bien-être en habitudes simples et mesurables. "
                "Demande les préférences, contraintes et limites utiles avant de proposer un planning. "
                "Ne pose aucun diagnostic, ne recommande aucun traitement et indique clairement les hypothèses."
            ),
        ),),
    ),
    "schedule_planning": AgentTemplate(
        id="schedule-organizer-v1",
        name="Planificateur d’agenda",
        domain="planning",
        description="Aide à organiser des tâches et des plages horaires selon les contraintes indiquées.",
        instructions=(
            "Propose des plannings cohérents à partir des disponibilités et préférences fournies. "
            "Ne consulte aucun agenda sans connecteur explicitement autorisé et ne crée ou modifie aucun événement sans approbation explicite. "
            "Signale les conflits et les hypothèses."
        ),
        capability=AgentCapability(id="schedule_planning", label="Planification d’agenda", template_id="schedule-organizer-v1"),
        skills=(AgentSkillTemplate(
            name="Planification selon les contraintes",
            description="Organiser les tâches selon les disponibilités et les priorités données.",
            instructions=(
                "Organise les tâches selon leur priorité, leur durée et les disponibilités fournies. "
                "Signale les conflits, distingue les faits des hypothèses et demande confirmation avant toute modification d’agenda."
            ),
        ),),
    ),
}


def list_capabilities() -> list[AgentCapability]:
    return [template.capability for template in TEMPLATES.values()]
