# choistats API — schema (source of truth)

> Gerado por `scripts/scraper/bin/document_choistats_api`. Re-rode pra detectar drift. Fixture amostra: **19693460**. Gerado em 2026-05-28 14:30 UTC.

Base: `https://api.choistats.com` · auth: header `X-Adamchoi-Api-Token` + query `token` + `Referer: https://www.adamchoi.co.uk/` (sem isso = 401).

## ⚑ FT actuals (settlement de apostas)

Os stats finais de um jogo NÃO ficam no objeto `fixture` (header), que só tem `homeGoalsFt/awayGoalsFt/homeReds/awayReds`. Eles ficam no array `recentHomeResults[0]` / `recentAwayResults[0]` do widget `recent_results` — o jogo recém-disputado aparece como o resultado mais recente do time, com stats completos.

### `recentHomeResults[0]` (= a fixture disputada, id=19693460)

| campo | tipo | exemplo |
|---|---|---|
| `id` | int | 19693460 |
| `league.id` | int | 1122 |
| `league.name` | string | "Copa Libertadores" |
| `league.slug` | string | "copa-libertadores" |
| `league.logoUrl` | string | https://cdn.sportmonks.com/images/soc... |
| `league.country.name` | string | "South America" |
| `league.country.slug` | string | "south-america" |
| `date` | int | 1779841800000 |
| `homeTeam.id` | int | 1024 |
| `homeTeam.name` | string | "Flamengo" |
| `homeTeam.slug` | string | "flamengo" |
| `homeTeam.logo` | string | https://cdn.sportmonks.com/images/soc... |
| `awayTeam.id` | int | 10976 |
| `awayTeam.name` | string | "Cusco FC" |
| `awayTeam.slug` | string | "cusco-fc" |
| `awayTeam.logo` | string | https://cdn.sportmonks.com/images/soc... |
| `seasonId` | int | 26784 |
| `groupId` | int | 253852 |
| `homeGoalsHt` | int | 0 |
| `awayGoalsHt` | int | 0 |
| `homeGoalsFt` | int | 3 |
| `awayGoalsFt` | int | 0 |
| `homeCorners` | int | 9 |
| `awayCorners` | int | 2 |
| `homeYellows` | int | 0 |
| `awayYellows` | int | 5 |
| `homeReds` | int | 0 |
| `awayReds` | int | 0 |
| `homeYellowReds` | int | 0 |
| `awayYellowReds` | int | 0 |
| `homeTotalShots` | int | 22 |
| `awayTotalShots` | int | 4 |
| `homeShotsOnTarget` | int | 15 |
| `awayShotsOnTarget` | int | 1 |
| `homeOffsides` | int | 1 |
| `awayOffsides` | int | 2 |
| `homeFouls` | int | 11 |
| `awayFouls` | int | 12 |
| `homeBookingPoints` | int | 0 |
| `awayBookingPoints` | int | 50 |
| `homeGoalKicks` | int | 3 |
| `awayGoalKicks` | int | 14 |
| `homeThrowIns` | int | 14 |
| `awayThrowIns` | int | 11 |
| `homeTackles` | int | 15 |
| `awayTackles` | int | 8 |
| `status` | string | "FT" |
| `referee.id` | int | 53019 |
| `referee.name` | string | "José Burgos" |
| `referee.slug` | string | "jose-burgos" |
| `result` | string | "W" |
| `htResult` | string | "D" |
| `isCompleted` | bool | true |
| `slug` | string | "flamengo-v-cusco-fc" |

### Mapa market -> campo de actual

| market | campos necessários | presente? |
|---|---|---|
| 1x2 | `homeGoalsFt`, `awayGoalsFt` | ✅ |
| over25 | `homeGoalsFt`, `awayGoalsFt` | ✅ |
| btts | `homeGoalsFt`, `awayGoalsFt` | ✅ |
| corners | `homeCorners`, `awayCorners` | ✅ |
| sot | `homeShotsOnTarget`, `awayShotsOnTarget` | ✅ |
| cards | `homeYellows`, `awayYellows`, `homeReds`, `awayReds`, `homeBookingPoints`, `awayBookingPoints` | ✅ |

## Widgets

### `recent_results`

Top-level keys: `fixture`, `recentHomeResults`, `recentHomeAllResults`, `recentAwayResults`, `recentAwayAllResults`, `headToHead`, `quickStats`, `homeTeamId`, `awayTeamId`

<details><summary>557 campos folha</summary>

| campo | tipo | exemplo |
|---|---|---|
| `fixture.id` | int | 19693460 |
| `fixture.league.id` | int | 1122 |
| `fixture.league.name` | string | "Copa Libertadores" |
| `fixture.league.slug` | string | "copa-libertadores" |
| `fixture.league.logoUrl` | string | https://cdn.sportmonks.com/images/soc... |
| `fixture.league.country.name` | string | "South America" |
| `fixture.league.country.slug` | string | "south-america" |
| `fixture.league.hasPlayerStats` | bool | true |
| `fixture.date` | int | 1779841800000 |
| `fixture.homeTeam.id` | int | 1024 |
| `fixture.homeTeam.name` | string | "Flamengo" |
| `fixture.homeTeam.slug` | string | "flamengo" |
| `fixture.homeTeam.logo` | string | https://cdn.sportmonks.com/images/soc... |
| `fixture.homeTeam.isNational` | bool | false |
| `fixture.awayTeam.id` | int | 10976 |
| `fixture.awayTeam.name` | string | "Cusco FC" |
| `fixture.awayTeam.slug` | string | "cusco-fc" |
| `fixture.awayTeam.logo` | string | https://cdn.sportmonks.com/images/soc... |
| `fixture.awayTeam.isNational` | bool | false |
| `fixture.seasonId` | int | 26784 |
| `fixture.homeGoalsFt` | int | 3 |
| `fixture.awayGoalsFt` | int | 0 |
| `fixture.homeReds` | int | 0 |
| `fixture.awayReds` | int | 0 |
| `fixture.status` | string | "FT" |
| `fixture.referee.id` | int | 53019 |
| `fixture.referee.name` | string | "José Burgos" |
| `fixture.referee.slug` | string | "jose-burgos" |
| `fixture.homeTeamPosition` | string | "1st" |
| `fixture.awayTeamPosition` | string | "4th" |
| `fixture.isCompleted` | bool | true |
| `fixture.homeTeamHomeAvgs.numMatches` | int | 10 |
| `fixture.homeTeamHomeAvgs.avgGoalsTotal` | float | 2.9 |
| `fixture.homeTeamHomeAvgs.avgGoalsFor` | float | 2.1 |
| `fixture.homeTeamHomeAvgs.avgGoalsAg` | float | 0.8 |
| `fixture.homeTeamHomeAvgs.firstHalfGoalsFor` | float | 0.6 |
| `fixture.homeTeamHomeAvgs.firstHalfGoalsAg` | float | 0.3 |
| `fixture.homeTeamHomeAvgs.firstHalfGoalsTotal` | float | 0.9 |
| `fixture.homeTeamHomeAvgs.secondHalfGoalsFor` | float | 1.5 |
| `fixture.homeTeamHomeAvgs.secondHalfGoalsAg` | float | 0.5 |
| `fixture.homeTeamHomeAvgs.secondHalfGoalsTotal` | float | 2.0 |
| `fixture.homeTeamHomeAvgs.cornersFor` | float | 5.2 |
| `fixture.homeTeamHomeAvgs.cornersAg` | float | 3.9 |
| `fixture.homeTeamHomeAvgs.cornersTotal` | float | 9.1 |
| `fixture.homeTeamHomeAvgs.cornersFor1h` | float | 1.8 |
| `fixture.homeTeamHomeAvgs.cornersAg1h` | float | 1.4 |
| `fixture.homeTeamHomeAvgs.cornersTotal1h` | float | 3.2 |
| `fixture.homeTeamHomeAvgs.cornersFor2h` | float | 1.8 |
| `fixture.homeTeamHomeAvgs.cornersAg2h` | float | 1.6 |
| `fixture.homeTeamHomeAvgs.cornersTotal2h` | float | 3.2 |
| `fixture.homeTeamHomeAvgs.bookingPointsFor` | float | 24.5 |
| `fixture.homeTeamHomeAvgs.bookingPointsAg` | float | 31.0 |
| `fixture.homeTeamHomeAvgs.bookingPointsTotal` | float | 55.5 |
| `fixture.homeTeamHomeAvgs.cardsFor` | float | 2.3 |
| `fixture.homeTeamHomeAvgs.cardsAg` | float | 3.1 |
| `fixture.homeTeamHomeAvgs.cardsTotal` | float | 5.4 |
| `fixture.homeTeamHomeAvgs.foulsConceded` | float | 11.5 |
| `fixture.homeTeamHomeAvgs.foulsWon` | float | 13.1 |
| `fixture.homeTeamHomeAvgs.offsidesTotal` | float | 2.6 |
| `fixture.homeTeamHomeAvgs.offsidesFor` | float | 1.2 |
| `fixture.homeTeamHomeAvgs.offsidesAg` | float | 1.4 |
| `fixture.homeTeamHomeAvgs.shotsFor` | float | 17.6 |
| `fixture.homeTeamHomeAvgs.shotsAg` | float | 11.1 |
| `fixture.homeTeamHomeAvgs.shotsOnTargetFor` | float | 6.5 |
| `fixture.homeTeamHomeAvgs.shotsOnTargetAg` | float | 3.2 |
| `fixture.homeTeamHomeAvgs.goalKicksTotal` | float | 15.6 |
| `fixture.homeTeamHomeAvgs.goalKicksFor` | float | 5.7 |
| `fixture.homeTeamHomeAvgs.goalKicksAg` | float | 9.9 |
| `fixture.homeTeamHomeAvgs.throwInsTotal` | float | 28.6 |
| `fixture.homeTeamHomeAvgs.throwInsFor` | float | 14.5 |
| `fixture.homeTeamHomeAvgs.throwInsAg` | float | 14.1 |
| `fixture.homeTeamHomeAvgs.tacklesTotal` | float | 27.0 |
| `fixture.homeTeamHomeAvgs.tacklesFor` | float | 13.5 |
| `fixture.homeTeamHomeAvgs.tacklesAg` | float | 13.5 |
| `fixture.homeTeamOverallAvgs.numMatches` | int | 21 |
| `fixture.homeTeamOverallAvgs.avgGoalsTotal` | float | 2.7 |
| `fixture.homeTeamOverallAvgs.avgGoalsFor` | float | 1.9 |
| `fixture.homeTeamOverallAvgs.avgGoalsAg` | float | 0.9 |
| `fixture.homeTeamOverallAvgs.firstHalfGoalsFor` | float | 0.8 |
| `fixture.homeTeamOverallAvgs.firstHalfGoalsAg` | float | 0.3 |
| `fixture.homeTeamOverallAvgs.firstHalfGoalsTotal` | float | 1.1 |
| `fixture.homeTeamOverallAvgs.secondHalfGoalsFor` | float | 1.1 |
| `fixture.homeTeamOverallAvgs.secondHalfGoalsAg` | float | 0.5 |
| `fixture.homeTeamOverallAvgs.secondHalfGoalsTotal` | float | 1.6 |
| `fixture.homeTeamOverallAvgs.cornersFor` | float | 4.6 |
| `fixture.homeTeamOverallAvgs.cornersAg` | float | 4.8 |
| `fixture.homeTeamOverallAvgs.cornersTotal` | float | 9.4 |
| `fixture.homeTeamOverallAvgs.cornersFor1h` | float | 1.6 |
| `fixture.homeTeamOverallAvgs.cornersAg1h` | float | 1.8 |
| `fixture.homeTeamOverallAvgs.cornersTotal1h` | float | 3.4 |
| `fixture.homeTeamOverallAvgs.cornersFor2h` | float | 1.8 |
| `fixture.homeTeamOverallAvgs.cornersAg2h` | float | 2.0 |
| `fixture.homeTeamOverallAvgs.cornersTotal2h` | float | 3.7 |
| `fixture.homeTeamOverallAvgs.bookingPointsFor` | float | 28.1 |
| `fixture.homeTeamOverallAvgs.bookingPointsAg` | float | 28.3 |
| `fixture.homeTeamOverallAvgs.bookingPointsTotal` | float | 56.4 |
| `fixture.homeTeamOverallAvgs.cardsFor` | float | 2.4 |
| `fixture.homeTeamOverallAvgs.cardsAg` | float | 2.8 |
| `fixture.homeTeamOverallAvgs.cardsTotal` | float | 5.1 |
| `fixture.homeTeamOverallAvgs.foulsConceded` | float | 11.4 |
| `fixture.homeTeamOverallAvgs.foulsWon` | float | 12.9 |
| `fixture.homeTeamOverallAvgs.offsidesTotal` | float | 2.8 |
| `fixture.homeTeamOverallAvgs.offsidesFor` | float | 1.2 |
| `fixture.homeTeamOverallAvgs.offsidesAg` | float | 1.6 |
| `fixture.homeTeamOverallAvgs.shotsFor` | float | 15.1 |
| `fixture.homeTeamOverallAvgs.shotsAg` | float | 12.0 |
| `fixture.homeTeamOverallAvgs.shotsOnTargetFor` | float | 5.7 |
| `fixture.homeTeamOverallAvgs.shotsOnTargetAg` | float | 3.6 |
| `fixture.homeTeamOverallAvgs.goalKicksTotal` | float | 14.5 |
| `fixture.homeTeamOverallAvgs.goalKicksFor` | float | 6.3 |
| `fixture.homeTeamOverallAvgs.goalKicksAg` | float | 8.1 |
| `fixture.homeTeamOverallAvgs.throwInsTotal` | float | 31.5 |
| `fixture.homeTeamOverallAvgs.throwInsFor` | float | 15.5 |
| `fixture.homeTeamOverallAvgs.throwInsAg` | float | 16.0 |
| `fixture.homeTeamOverallAvgs.tacklesTotal` | float | 28.3 |
| `fixture.homeTeamOverallAvgs.tacklesFor` | float | 14.3 |
| `fixture.homeTeamOverallAvgs.tacklesAg` | float | 14.0 |
| `fixture.awayTeamAwayAvgs.numMatches` | int | 11 |
| `fixture.awayTeamAwayAvgs.avgGoalsTotal` | float | 2.9 |
| `fixture.awayTeamAwayAvgs.avgGoalsFor` | float | 0.8 |

_(truncado em 120 de 557)_

</details>

### `team_records`

Top-level keys: `homeTeamHomeRecord`, `homeTeamOverallRecord`, `awayTeamAwayRecord`, `awayTeamOverallRecord`, `homeTeamResultsWithStandings`, `awayTeamResultsWithStandings`, `homeTeamResultsWithStandingsStage`, `awayTeamResultsWithStandingsStage`, `homeTeamId`, `awayTeamId`, `fixtureWithoutStats`

<details><summary>181 campos folha</summary>

| campo | tipo | exemplo |
|---|---|---|
| `homeTeamHomeRecord.type` | string | "Home" |
| `homeTeamHomeRecord.position` | string | "1st" |
| `homeTeamHomeRecord.played` | int | 3 |
| `homeTeamHomeRecord.won` | int | 3 |
| `homeTeamHomeRecord.draw` | int | 0 |
| `homeTeamHomeRecord.lost` | int | 0 |
| `homeTeamHomeRecord.goalsFor` | int | 8 |
| `homeTeamHomeRecord.goalsAg` | int | 1 |
| `homeTeamHomeRecord.goalDiff` | int | 7 |
| `homeTeamHomeRecord.points` | int | 9 |
| `homeTeamHomeRecord.pointsPerGame` | float | 3.0 |
| `homeTeamOverallRecord.type` | string | "All" |
| `homeTeamOverallRecord.position` | string | "1st" |
| `homeTeamOverallRecord.played` | int | 5 |
| `homeTeamOverallRecord.won` | int | 4 |
| `homeTeamOverallRecord.draw` | int | 1 |
| `homeTeamOverallRecord.lost` | int | 0 |
| `homeTeamOverallRecord.goalsFor` | int | 11 |
| `homeTeamOverallRecord.goalsAg` | int | 2 |
| `homeTeamOverallRecord.goalDiff` | int | 9 |
| `homeTeamOverallRecord.points` | int | 13 |
| `homeTeamOverallRecord.pointsPerGame` | float | 2.6 |
| `awayTeamAwayRecord.type` | string | "Away" |
| `awayTeamAwayRecord.position` | string | "4th" |
| `awayTeamAwayRecord.played` | int | 3 |
| `awayTeamAwayRecord.won` | int | 0 |
| `awayTeamAwayRecord.draw` | int | 0 |
| `awayTeamAwayRecord.lost` | int | 3 |
| `awayTeamAwayRecord.goalsFor` | int | 1 |
| `awayTeamAwayRecord.goalsAg` | int | 6 |
| `awayTeamAwayRecord.goalDiff` | int | -5 |
| `awayTeamAwayRecord.points` | int | 0 |
| `awayTeamAwayRecord.pointsPerGame` | float | 0.0 |
| `awayTeamOverallRecord.type` | string | "All" |
| `awayTeamOverallRecord.position` | string | "4th" |
| `awayTeamOverallRecord.played` | int | 6 |
| `awayTeamOverallRecord.won` | int | 0 |
| `awayTeamOverallRecord.draw` | int | 1 |
| `awayTeamOverallRecord.lost` | int | 5 |
| `awayTeamOverallRecord.goalsFor` | int | 4 |
| `awayTeamOverallRecord.goalsAg` | int | 12 |
| `awayTeamOverallRecord.goalDiff` | int | -8 |
| `awayTeamOverallRecord.points` | int | 1 |
| `awayTeamOverallRecord.pointsPerGame` | float | 0.2 |
| `homeTeamResultsWithStandings[].position` | string | "1st" |
| `homeTeamResultsWithStandings[].team.id` | int | 1024 |
| `homeTeamResultsWithStandings[].team.name` | string | "Flamengo" |
| `homeTeamResultsWithStandings[].played` | int | 5 |
| `homeTeamResultsWithStandings[].goalDiff` | int | 9 |
| `homeTeamResultsWithStandings[].points` | int | 13 |
| `homeTeamResultsWithStandings[].positionType` | string | "8TH_FINALS" |
| `homeTeamResultsWithStandings[].positionTypeName` | string | "8th Finals" |
| `awayTeamResultsWithStandings[].position` | string | "1st" |
| `awayTeamResultsWithStandings[].team.id` | int | 1024 |
| `awayTeamResultsWithStandings[].team.name` | string | "Flamengo" |
| `awayTeamResultsWithStandings[].played` | int | 5 |
| `awayTeamResultsWithStandings[].goalDiff` | int | 9 |
| `awayTeamResultsWithStandings[].points` | int | 13 |
| `awayTeamResultsWithStandings[].homeResults[].date` | int | 1775694600000 |
| `awayTeamResultsWithStandings[].homeResults[].homeGoals` | int | 0 |
| `awayTeamResultsWithStandings[].homeResults[].awayGoals` | int | 2 |
| `awayTeamResultsWithStandings[].homeResults[].result` | string | "L" |
| `awayTeamResultsWithStandings[].awayResults[].date` | int | 1779841800000 |
| `awayTeamResultsWithStandings[].awayResults[].homeGoals` | int | 3 |
| `awayTeamResultsWithStandings[].awayResults[].awayGoals` | int | 0 |
| `awayTeamResultsWithStandings[].awayResults[].result` | string | "L" |
| `awayTeamResultsWithStandings[].positionType` | string | "8TH_FINALS" |
| `awayTeamResultsWithStandings[].positionTypeName` | string | "8th Finals" |
| `homeTeamResultsWithStandingsStage[].name` | string | "Group Stage" |
| `homeTeamResultsWithStandingsStage[].teamStandings[].position` | string | "1st" |
| `homeTeamResultsWithStandingsStage[].teamStandings[].team.id` | int | 1024 |
| `homeTeamResultsWithStandingsStage[].teamStandings[].team.name` | string | "Flamengo" |
| `homeTeamResultsWithStandingsStage[].teamStandings[].played` | int | 5 |
| `homeTeamResultsWithStandingsStage[].teamStandings[].goalDiff` | int | 9 |
| `homeTeamResultsWithStandingsStage[].teamStandings[].points` | int | 13 |
| `homeTeamResultsWithStandingsStage[].teamStandings[].positionType` | string | "8TH_FINALS" |
| `homeTeamResultsWithStandingsStage[].teamStandings[].positionTypeName` | string | "8th Finals" |
| `awayTeamResultsWithStandingsStage[].name` | string | "Group Stage" |
| `awayTeamResultsWithStandingsStage[].teamStandings[].position` | string | "1st" |
| `awayTeamResultsWithStandingsStage[].teamStandings[].team.id` | int | 1024 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].team.name` | string | "Flamengo" |
| `awayTeamResultsWithStandingsStage[].teamStandings[].played` | int | 5 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].goalDiff` | int | 9 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].points` | int | 13 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].homeResults[].date` | int | 1775694600000 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].homeResults[].homeGoals` | int | 0 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].homeResults[].awayGoals` | int | 2 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].homeResults[].result` | string | "L" |
| `awayTeamResultsWithStandingsStage[].teamStandings[].homeResults[].homeGoalsHt` | int | 0 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].homeResults[].awayGoalsHt` | int | 0 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].homeResults[].homeGoalsFt` | int | 0 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].homeResults[].awayGoalsFt` | int | 2 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].homeResults[].homeCorners` | int | 5 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].homeResults[].awayCorners` | int | 7 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].homeResults[].homeYellows` | int | 2 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].homeResults[].awayYellows` | int | 0 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].homeResults[].homeReds` | int | 0 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].homeResults[].awayReds` | int | 0 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].homeResults[].homeYellowReds` | int | 0 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].homeResults[].awayYellowReds` | int | 0 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].homeResults[].homeTotalShots` | int | 8 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].homeResults[].awayTotalShots` | int | 19 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].homeResults[].homeShotsOnTarget` | int | 2 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].homeResults[].awayShotsOnTarget` | int | 10 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].homeResults[].homeOffsides` | int | 5 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].homeResults[].awayOffsides` | int | 2 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].homeResults[].homeFouls` | int | 12 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].homeResults[].awayFouls` | int | 7 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].homeResults[].homeBookingPoints` | int | 20 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].homeResults[].awayBookingPoints` | int | 0 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].homeResults[].homeGoalKicks` | int | 8 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].homeResults[].awayGoalKicks` | int | 11 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].homeResults[].homeThrowIns` | int | 15 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].homeResults[].awayThrowIns` | int | 18 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].homeResults[].homeTackles` | int | 11 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].homeResults[].awayTackles` | int | 7 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].awayResults[].date` | int | 1779841800000 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].awayResults[].homeGoals` | int | 3 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].awayResults[].awayGoals` | int | 0 |
| `awayTeamResultsWithStandingsStage[].teamStandings[].awayResults[].result` | string | "L" |

_(truncado em 120 de 181)_

</details>

### `players`

Top-level keys: `fixture`, `homePlayers`, `awayPlayers`, `playerStatsForm`, `homeTeamId`, `awayTeamId`, `homeTeamSeasons`, `awayTeamSeasons`

<details><summary>254 campos folha</summary>

| campo | tipo | exemplo |
|---|---|---|
| `fixture.id` | int | 19693460 |
| `fixture.league.id` | int | 1122 |
| `fixture.league.name` | string | "Copa Libertadores" |
| `fixture.league.slug` | string | "copa-libertadores" |
| `fixture.league.logoUrl` | string | https://cdn.sportmonks.com/images/soc... |
| `fixture.league.country.name` | string | "South America" |
| `fixture.league.country.slug` | string | "south-america" |
| `fixture.league.hasPlayerStats` | bool | true |
| `fixture.date` | int | 1779841800000 |
| `fixture.homeTeam.id` | int | 1024 |
| `fixture.homeTeam.name` | string | "Flamengo" |
| `fixture.homeTeam.slug` | string | "flamengo" |
| `fixture.homeTeam.logo` | string | https://cdn.sportmonks.com/images/soc... |
| `fixture.homeTeam.isNational` | bool | false |
| `fixture.awayTeam.id` | int | 10976 |
| `fixture.awayTeam.name` | string | "Cusco FC" |
| `fixture.awayTeam.slug` | string | "cusco-fc" |
| `fixture.awayTeam.logo` | string | https://cdn.sportmonks.com/images/soc... |
| `fixture.awayTeam.isNational` | bool | false |
| `fixture.seasonId` | int | 26784 |
| `fixture.homeGoalsFt` | int | 3 |
| `fixture.awayGoalsFt` | int | 0 |
| `fixture.homeReds` | int | 0 |
| `fixture.awayReds` | int | 0 |
| `fixture.status` | string | "FT" |
| `fixture.referee.id` | int | 53019 |
| `fixture.referee.name` | string | "José Burgos" |
| `fixture.referee.slug` | string | "jose-burgos" |
| `fixture.homeTeamPosition` | string | "1st" |
| `fixture.awayTeamPosition` | string | "4th" |
| `fixture.isCompleted` | bool | true |
| `fixture.homeTeamHomeAvgs.numMatches` | int | 10 |
| `fixture.homeTeamHomeAvgs.avgGoalsTotal` | float | 2.9 |
| `fixture.homeTeamHomeAvgs.avgGoalsFor` | float | 2.1 |
| `fixture.homeTeamHomeAvgs.avgGoalsAg` | float | 0.8 |
| `fixture.homeTeamHomeAvgs.firstHalfGoalsFor` | float | 0.6 |
| `fixture.homeTeamHomeAvgs.firstHalfGoalsAg` | float | 0.3 |
| `fixture.homeTeamHomeAvgs.firstHalfGoalsTotal` | float | 0.9 |
| `fixture.homeTeamHomeAvgs.secondHalfGoalsFor` | float | 1.5 |
| `fixture.homeTeamHomeAvgs.secondHalfGoalsAg` | float | 0.5 |
| `fixture.homeTeamHomeAvgs.secondHalfGoalsTotal` | float | 2.0 |
| `fixture.homeTeamHomeAvgs.cornersFor` | float | 5.2 |
| `fixture.homeTeamHomeAvgs.cornersAg` | float | 3.9 |
| `fixture.homeTeamHomeAvgs.cornersTotal` | float | 9.1 |
| `fixture.homeTeamHomeAvgs.cornersFor1h` | float | 1.8 |
| `fixture.homeTeamHomeAvgs.cornersAg1h` | float | 1.4 |
| `fixture.homeTeamHomeAvgs.cornersTotal1h` | float | 3.2 |
| `fixture.homeTeamHomeAvgs.cornersFor2h` | float | 1.8 |
| `fixture.homeTeamHomeAvgs.cornersAg2h` | float | 1.6 |
| `fixture.homeTeamHomeAvgs.cornersTotal2h` | float | 3.2 |
| `fixture.homeTeamHomeAvgs.bookingPointsFor` | float | 24.5 |
| `fixture.homeTeamHomeAvgs.bookingPointsAg` | float | 31.0 |
| `fixture.homeTeamHomeAvgs.bookingPointsTotal` | float | 55.5 |
| `fixture.homeTeamHomeAvgs.cardsFor` | float | 2.3 |
| `fixture.homeTeamHomeAvgs.cardsAg` | float | 3.1 |
| `fixture.homeTeamHomeAvgs.cardsTotal` | float | 5.4 |
| `fixture.homeTeamHomeAvgs.foulsConceded` | float | 11.5 |
| `fixture.homeTeamHomeAvgs.foulsWon` | float | 13.1 |
| `fixture.homeTeamHomeAvgs.offsidesTotal` | float | 2.6 |
| `fixture.homeTeamHomeAvgs.offsidesFor` | float | 1.2 |
| `fixture.homeTeamHomeAvgs.offsidesAg` | float | 1.4 |
| `fixture.homeTeamHomeAvgs.shotsFor` | float | 17.6 |
| `fixture.homeTeamHomeAvgs.shotsAg` | float | 11.1 |
| `fixture.homeTeamHomeAvgs.shotsOnTargetFor` | float | 6.5 |
| `fixture.homeTeamHomeAvgs.shotsOnTargetAg` | float | 3.2 |
| `fixture.homeTeamHomeAvgs.goalKicksTotal` | float | 15.6 |
| `fixture.homeTeamHomeAvgs.goalKicksFor` | float | 5.7 |
| `fixture.homeTeamHomeAvgs.goalKicksAg` | float | 9.9 |
| `fixture.homeTeamHomeAvgs.throwInsTotal` | float | 28.6 |
| `fixture.homeTeamHomeAvgs.throwInsFor` | float | 14.5 |
| `fixture.homeTeamHomeAvgs.throwInsAg` | float | 14.1 |
| `fixture.homeTeamHomeAvgs.tacklesTotal` | float | 27.0 |
| `fixture.homeTeamHomeAvgs.tacklesFor` | float | 13.5 |
| `fixture.homeTeamHomeAvgs.tacklesAg` | float | 13.5 |
| `fixture.homeTeamOverallAvgs.numMatches` | int | 21 |
| `fixture.homeTeamOverallAvgs.avgGoalsTotal` | float | 2.7 |
| `fixture.homeTeamOverallAvgs.avgGoalsFor` | float | 1.9 |
| `fixture.homeTeamOverallAvgs.avgGoalsAg` | float | 0.9 |
| `fixture.homeTeamOverallAvgs.firstHalfGoalsFor` | float | 0.8 |
| `fixture.homeTeamOverallAvgs.firstHalfGoalsAg` | float | 0.3 |
| `fixture.homeTeamOverallAvgs.firstHalfGoalsTotal` | float | 1.1 |
| `fixture.homeTeamOverallAvgs.secondHalfGoalsFor` | float | 1.1 |
| `fixture.homeTeamOverallAvgs.secondHalfGoalsAg` | float | 0.5 |
| `fixture.homeTeamOverallAvgs.secondHalfGoalsTotal` | float | 1.6 |
| `fixture.homeTeamOverallAvgs.cornersFor` | float | 4.6 |
| `fixture.homeTeamOverallAvgs.cornersAg` | float | 4.8 |
| `fixture.homeTeamOverallAvgs.cornersTotal` | float | 9.4 |
| `fixture.homeTeamOverallAvgs.cornersFor1h` | float | 1.6 |
| `fixture.homeTeamOverallAvgs.cornersAg1h` | float | 1.8 |
| `fixture.homeTeamOverallAvgs.cornersTotal1h` | float | 3.4 |
| `fixture.homeTeamOverallAvgs.cornersFor2h` | float | 1.8 |
| `fixture.homeTeamOverallAvgs.cornersAg2h` | float | 2.0 |
| `fixture.homeTeamOverallAvgs.cornersTotal2h` | float | 3.7 |
| `fixture.homeTeamOverallAvgs.bookingPointsFor` | float | 28.1 |
| `fixture.homeTeamOverallAvgs.bookingPointsAg` | float | 28.3 |
| `fixture.homeTeamOverallAvgs.bookingPointsTotal` | float | 56.4 |
| `fixture.homeTeamOverallAvgs.cardsFor` | float | 2.4 |
| `fixture.homeTeamOverallAvgs.cardsAg` | float | 2.8 |
| `fixture.homeTeamOverallAvgs.cardsTotal` | float | 5.1 |
| `fixture.homeTeamOverallAvgs.foulsConceded` | float | 11.4 |
| `fixture.homeTeamOverallAvgs.foulsWon` | float | 12.9 |
| `fixture.homeTeamOverallAvgs.offsidesTotal` | float | 2.8 |
| `fixture.homeTeamOverallAvgs.offsidesFor` | float | 1.2 |
| `fixture.homeTeamOverallAvgs.offsidesAg` | float | 1.6 |
| `fixture.homeTeamOverallAvgs.shotsFor` | float | 15.1 |
| `fixture.homeTeamOverallAvgs.shotsAg` | float | 12.0 |
| `fixture.homeTeamOverallAvgs.shotsOnTargetFor` | float | 5.7 |
| `fixture.homeTeamOverallAvgs.shotsOnTargetAg` | float | 3.6 |
| `fixture.homeTeamOverallAvgs.goalKicksTotal` | float | 14.5 |
| `fixture.homeTeamOverallAvgs.goalKicksFor` | float | 6.3 |
| `fixture.homeTeamOverallAvgs.goalKicksAg` | float | 8.1 |
| `fixture.homeTeamOverallAvgs.throwInsTotal` | float | 31.5 |
| `fixture.homeTeamOverallAvgs.throwInsFor` | float | 15.5 |
| `fixture.homeTeamOverallAvgs.throwInsAg` | float | 16.0 |
| `fixture.homeTeamOverallAvgs.tacklesTotal` | float | 28.3 |
| `fixture.homeTeamOverallAvgs.tacklesFor` | float | 14.3 |
| `fixture.homeTeamOverallAvgs.tacklesAg` | float | 14.0 |
| `fixture.awayTeamAwayAvgs.numMatches` | int | 11 |
| `fixture.awayTeamAwayAvgs.avgGoalsTotal` | float | 2.9 |
| `fixture.awayTeamAwayAvgs.avgGoalsFor` | float | 0.8 |

_(truncado em 120 de 254)_

</details>

### `chances`

Top-level keys: `(array)`

<details><summary>0 campos folha</summary>

_(empty)_

</details>

### `odds`

Top-level keys: `(array)`

<details><summary>38 campos folha</summary>

| campo | tipo | exemplo |
|---|---|---|
| `market.name` | string | "Result" |
| `market.displayRule` | string | "THREE_WAY" |
| `outcomes.Flamengo.fixtureId` | int | 19693460 |
| `outcomes.Flamengo.outcome` | string | "RESULT_HOME_WIN" |
| `outcomes.Flamengo.outcomeName` | string | "Flamengo" |
| `outcomes.Flamengo.bookmaker` | string | "UNIBET" |
| `outcomes.Flamengo.decimalOdds` | float | 1.11 |
| `outcomes.Flamengo.fractionalOdds` | string | "1/10" |
| `outcomes.Flamengo.externalFixtureId` | string | "1027027378" |
| `outcomes.Flamengo.externalBetId` | string | "4193622378" |
| `outcomes.Flamengo.teamId` | int | 1024 |
| `outcomes.Flamengo.bookmakerFixtureUrl` | string | https://b1.trickyrock.com/redirect.as... |
| `outcomes.Flamengo.playerId` | int | 0 |
| `outcomes.Flamengo.bookmakerBetUrl` | string | https://b1.trickyrock.com/redirect.as... |
| `outcomes.Draw.fixtureId` | int | 19693460 |
| `outcomes.Draw.outcome` | string | "RESULT_DRAW" |
| `outcomes.Draw.outcomeName` | string | "Draw" |
| `outcomes.Draw.bookmaker` | string | "UNIBET" |
| `outcomes.Draw.decimalOdds` | float | 9.0 |
| `outcomes.Draw.fractionalOdds` | string | "8/1" |
| `outcomes.Draw.externalFixtureId` | string | "1027027378" |
| `outcomes.Draw.externalBetId` | string | "4193622379" |
| `outcomes.Draw.teamId` | int | 1024 |
| `outcomes.Draw.bookmakerFixtureUrl` | string | https://b1.trickyrock.com/redirect.as... |
| `outcomes.Draw.playerId` | int | 0 |
| `outcomes.Draw.bookmakerBetUrl` | string | https://b1.trickyrock.com/redirect.as... |
| `outcomes.Cusco FC.fixtureId` | int | 19693460 |
| `outcomes.Cusco FC.outcome` | string | "RESULT_AWAY_WIN" |
| `outcomes.Cusco FC.outcomeName` | string | "Cusco FC" |
| `outcomes.Cusco FC.bookmaker` | string | "UNIBET" |
| `outcomes.Cusco FC.decimalOdds` | float | 18.0 |
| `outcomes.Cusco FC.fractionalOdds` | string | "17/1" |
| `outcomes.Cusco FC.externalFixtureId` | string | "1027027378" |
| `outcomes.Cusco FC.externalBetId` | string | "4193622380" |
| `outcomes.Cusco FC.teamId` | int | 1024 |
| `outcomes.Cusco FC.bookmakerFixtureUrl` | string | https://b1.trickyrock.com/redirect.as... |
| `outcomes.Cusco FC.playerId` | int | 0 |
| `outcomes.Cusco FC.bookmakerBetUrl` | string | https://b1.trickyrock.com/redirect.as... |

</details>

