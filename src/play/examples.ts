/** The examples the syntax reference can load into the playground. Same text as the fixtures. */
export const EXAMPLES: Record<string, string> = {
  flowchart: `diagram flowchart
id approval
title After review, a request takes exactly one of two paths
desc Flowchart. Start, submit request, review request, then the decision approved?. Yes leads to schedule the work, then end. No leads to notify requester, then end.
narration A submitted request is reviewed, then approved or rejected.

start begin
process submit "submit request"
process review "review request"
decision ok "approved?"
process schedule "schedule the work"
process notify "notify requester"
end done

begin -> submit
submit -> review
review -> ok
ok -> schedule : yes
ok -> notify : no
schedule -> done
notify -> done
`,
  activity: `diagram activity
id onboarding
title A new hire's laptop and badge are prepared at the same time
narration After the offer is accepted, IT orders the laptop and security prints the badge at the same time.

start begin
action accept "accept offer"
begin -> accept

step 1
fork split
action laptop "order laptop"
action badge "print badge"
accept -> split
split -> laptop
split -> badge

step 2
join wait
action first "first day"
end done
laptop -> wait
badge -> wait
wait -> first
first -> done
`,
  "use-case": `diagram use-case
id permit-portal
title Residents apply and track; paying the fee is always part of applying
narration Apply for permit includes pay fee. Request fee waiver extends pay fee, but only for some residents.

actor resident "Resident"
actor clerk "Permit clerk" right
boundary portal "Permit portal" {
  use-case apply "apply for permit"
  use-case track "track status"
  use-case review "review application"
  use-case pay "pay fee"
  use-case waiver "request fee waiver"
}

resident -- apply
resident -- track
clerk -- review
apply -include-> pay
waiver -extend-> pay
`,
};

export const DEFAULT_EXAMPLE = EXAMPLES["use-case"];
