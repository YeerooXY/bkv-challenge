"""Rarity tiers: 0 common, 1 uncommon, 2 rare, 3 epic, 4 legendary.

Lines are rated from the timetable: night service, terminals out in the agglomeration, very few trips.
Plates are rated from how few vehicles of their model exist and how long since they last signed in.
"""
from datetime import date

TIERS = ["common", "uncommon", "rare", "epic", "legendary"]

# Towns around Budapest. A stop named "Town, Stop" belongs to that town.
AGGLOMERATION = {
    "Gödöllő", "Budakeszi", "Páty", "Solymár", "Mogyoród", "Diósd", "Budakalász", "Pilisborosjenő", "Budaörs", "Üröm",
    "Szigetszentmiklós", "Telki", "Tök", "Zsámbék", "Perbál", "Pécel", "Gyál", "Nagykovácsi", "Kistarcsa", "Törökbálint",
    "Budaliget", "Vecsés", "Budajenő", "Pomáz", "Dunakeszi", "Maglód", "Szentendre", "Kerepes", "Érd", "Százhalombatta",
    "Dunaharaszti", "Szigethalom", "Halásztelek", "Fót", "Csömör", "Pilisvörösvár", "Biatorbágy", "Ócsa", "Üllő", "Gyömrő",
    "Isaszeg", "Pilisszentiván", "Törökbálint", "Szigetújfalu", "Tárnok", "Sóskút", "Alsónémedi", "Gyömrő", "Veresegyház",
}


def in_agglomeration(stop_name: str) -> bool:
    return stop_name.split(", ")[0] in AGGLOMERATION if ", " in stop_name else False


def line_rarity(weekday_trips, terminals, night_share):
    """Returns (tier, reasons). terminals: stop names at the ends of the line's directions.
    Reasons: night, out2 (both ends outside Budapest), out1 (one end outside), few (12 trips a weekday or fewer)."""
    ends = [in_agglomeration(n) for n in terminals]
    score, why = 0, []
    if night_share >= 0.9 and sum(weekday_trips) > 0:
        score += 2; why.append("night")
    if ends and all(ends):
        score += 2; why.append("out2")
    elif any(ends):
        score += 1; why.append("out1")
    if 0 < sum(weekday_trips) <= 12:
        score += 1; why.append("few")
    return min(score, 4), why


def plate_rarity(model_count, last_login, heritage, today=None):
    n = model_count
    tier = 4 if n <= 2 else 3 if n <= 6 else 2 if n <= 20 else 1 if n <= 60 else 0
    if heritage:
        tier = 4
    try:
        days = ((today or date.today()) - date.fromisoformat(last_login)).days
    except (TypeError, ValueError):
        days = 0
    if days >= 120:
        tier += 2
    elif days >= 45:
        tier += 1
    return min(tier, 4)
