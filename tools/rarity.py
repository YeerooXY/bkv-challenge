"""Rarity tiers: 0 common, 1 uncommon, 2 rare, 3 epic, 4 legendary, 5 mythic, 6 artifact.

Plates: how long since the vehicle last signed on (3 days uncommon, 7 rare, 14 legendary, 30 mythic,
90 artifact), pushed up when few vehicles of its model exist; heritage buses are at least legendary.
Lines: night service, terminals out in the agglomeration, very few trips. A line that starts AND ends
outside Budapest is mythic; a night line that does is an artifact.
"""
from datetime import date

TIERS = ["common", "uncommon", "rare", "epic", "legendary", "mythic", "artifact"]

# Towns around Budapest. A stop named "Town, Stop" belongs to that town.
AGGLOMERATION = {
    "Gödöllő", "Budakeszi", "Páty", "Solymár", "Mogyoród", "Diósd", "Budakalász", "Pilisborosjenő", "Budaörs", "Üröm",
    "Szigetszentmiklós", "Telki", "Tök", "Zsámbék", "Perbál", "Pécel", "Gyál", "Nagykovácsi", "Kistarcsa", "Törökbálint",
    "Budaliget", "Vecsés", "Budajenő", "Pomáz", "Dunakeszi", "Maglód", "Szentendre", "Kerepes", "Érd", "Százhalombatta",
    "Dunaharaszti", "Szigethalom", "Halásztelek", "Fót", "Csömör", "Pilisvörösvár", "Biatorbágy", "Ócsa", "Üllő", "Gyömrő",
    "Isaszeg", "Pilisszentiván", "Szigetújfalu", "Tárnok", "Sóskút", "Alsónémedi", "Veresegyház",
}


import math

CENTER = (47.4979, 19.0402)  # Deak Ferenc ter
OUTSIDE_KM = 17  # beyond this the stop is outside the city limits (the eastern and southern districts reach about 15 km)


def outside_budapest(stop_name: str, lat: float, lon: float) -> bool:
    """A stop is outside Budapest when it is named after a town around the city or lies far from the center."""
    if ", " in stop_name and stop_name.split(", ")[0] in AGGLOMERATION:
        return True
    r = math.pi / 180
    h = math.sin((lat - CENTER[0]) * r / 2) ** 2 + math.cos(CENTER[0] * r) * math.cos(lat * r) * math.sin((lon - CENTER[1]) * r / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h)) > OUTSIDE_KM


def line_rarity(weekday_trips, ends, night_share):
    """Returns (tier, reasons). ends: one boolean per line end, True if that end is outside Budapest.
    Reasons: night, out2 (both ends outside Budapest), out1 (one end outside), few (12 trips a weekday or fewer)."""
    score, why = 0, []
    night = night_share >= 0.9 and sum(weekday_trips) > 0
    if night:
        score += 2; why.append("night")
    out2 = bool(ends) and all(ends)
    if out2:
        why.append("out2")
    elif any(ends):
        score += 1; why.append("out1")
    if 0 < sum(weekday_trips) <= 12:
        score += 1; why.append("few")
    tier = min(score, 4)
    if out2:
        tier = 6 if night else 5
    return tier, why


def idle_days(last_login, today=None):
    try:
        return max(0, ((today or date.today()) - date.fromisoformat(last_login)).days)
    except (TypeError, ValueError):
        return 0


def plate_rarity(model_count, last_login, heritage, today=None, ignore_idle=False):
    days = 0 if ignore_idle else idle_days(last_login, today)
    tier = 6 if days >= 90 else 5 if days >= 30 else 4 if days >= 14 else 2 if days >= 7 else 1 if days >= 3 else 0
    # Few vehicles of a model make every one of them rarer.
    if model_count <= 2:
        tier += 2
    elif model_count <= 6:
        tier += 1
    if heritage:
        tier = max(tier, 4)
    return min(tier, 6)
