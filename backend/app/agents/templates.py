from dataclasses import dataclass

from app.agents.models import AgentCapability


@dataclass(frozen=True)
class AgentTemplate:
    id: str
    name: str
    domain: str
    description: str
    instructions: str
    capability: AgentCapability
    version: int = 1


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
    ),
}


def list_capabilities() -> list[AgentCapability]:
    return [template.capability for template in TEMPLATES.values()]
