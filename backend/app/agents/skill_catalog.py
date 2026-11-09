from app.agents.skills import SkillCatalogItem


# Curated, versioned skills shipped with the application. No network lookup is used.
_RESEARCH_V1 = SkillCatalogItem(
    id="research.source-review",
    name="Vérification des sources",
    description="Évalue la qualité et la traçabilité des sources avant une synthèse.",
    instructions="Distingue les faits vérifiés des hypothèses. Cite les sources fournies avec précision, signale les informations manquantes et ne fabrique jamais de référence.",
    category="research", tags=["sources", "fiabilité", "synthèse"], version=1,
    author="Équipe Mutual-AId", updated_at="2026-10-20",
)

SKILL_CATALOG: tuple[SkillCatalogItem, ...] = (
    SkillCatalogItem(
        id="research.source-review",
        name="Vérification des sources",
        description="Évalue la qualité, la date et la traçabilité des sources avant une synthèse.",
        instructions="Distingue les faits vérifiés des hypothèses. Cite les sources fournies avec précision, signale les informations manquantes et ne fabrique jamais de référence. Vérifie la date et le contexte de chaque source et indique lorsqu’elle ne suffit pas à confirmer une affirmation.",
        category="research", tags=["sources", "fiabilité", "synthèse"], version=2,
        author="Équipe Mutual-AId", updated_at="2026-11-09",
    ),
    SkillCatalogItem(
        id="writing.clear-briefs",
        name="Rédaction de briefs clairs",
        description="Transforme les informations disponibles en brief concis et exploitable.",
        instructions="Commence par l’objectif et le public visé. Sépare décisions, faits et questions ouvertes. Utilise des titres courts et termine par les prochaines actions utiles.",
        category="writing", tags=["brief", "rédaction", "clarté"], version=1,
        author="Équipe Mutual-AId", updated_at="2026-10-20",
    ),
    SkillCatalogItem(
        id="planning.realistic-schedule",
        name="Planification réaliste",
        description="Construit un plan avec priorités, marges et dépendances visibles.",
        instructions="Respecte les contraintes de temps déclarées. Rends explicites les dépendances et les hypothèses. Prévois une marge raisonnable et demande une précision lorsque deux contraintes sont incompatibles.",
        category="planning", tags=["agenda", "priorités", "dépendances"], version=1,
        author="Équipe Mutual-AId", updated_at="2026-10-20",
    ),
    SkillCatalogItem(
        id="analysis.structured-review",
        name="Analyse structurée",
        description="Organise une analyse en constats, éléments probants et limites.",
        instructions="Présente les constats avant les recommandations. Appuie chaque conclusion sur les données disponibles, expose les limites et distingue clairement corrélation et causalité.",
        category="analysis", tags=["analyse", "données", "limites"], version=1,
        author="Équipe Mutual-AId", updated_at="2026-10-20",
    ),
)

SKILL_CATALOG_VERSIONS: dict[str, tuple[SkillCatalogItem, ...]] = {
    "research.source-review": (_RESEARCH_V1, SKILL_CATALOG[0]),
    **{item.id: (item,) for item in SKILL_CATALOG if item.id != "research.source-review"},
}


def catalog_skill(skill_id: str) -> SkillCatalogItem | None:
    return next((item for item in SKILL_CATALOG if item.id == skill_id), None)


def catalog_skill_version(skill_id: str, version: int) -> SkillCatalogItem | None:
    return next((item for item in SKILL_CATALOG_VERSIONS.get(skill_id, ()) if item.version == version), None)


def search_catalog(query: str = "", category: str | None = None) -> list[SkillCatalogItem]:
    normalized = query.strip().casefold()
    return [
        item for item in SKILL_CATALOG
        if (category is None or item.category == category)
        and (not normalized or normalized in " ".join((item.name, item.description, item.category, *item.tags)).casefold())
    ]
