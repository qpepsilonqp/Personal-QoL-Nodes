For the moment 3 nodes which consist of 

ForceChangedNode:
A node that has a model text and seed input, assuming you are using positive and negative conditioning use a Text Concatenate node to concatenate the text into a single string 
and wire it into the Force Changed (seed + text) node, wire in you seed and wire the model into the Force Changed (seed + text) before a stateful node, it will change and therefore 
will force the stateful node to recalculate.

SigmasAtPercent:
Does what it says on the tin, takes the sigmas from your scheduler and allows you to pick the sigmas value at a from 0 to 1, useful for things like 
"Perturbed-Attention Guidance (Advanced)" which need you to input the sigmas values rather than steps or a linear 0 to 1 more useful for older models admittedly as more modern
models use sigmas of 0 to 1 anyway, but it's not linear and is a curve, so if you want to end or start at a specific point it's just more intuitive.

Resolution 1mp picker: 
every somewhat useful resolution that is roughly 1MP and devisable by 16, honestly I will probably replace this with something a little bit less brute force and add a multiplier, 
but it's the node I care about the least because there are an ocean of resolution nodes out there.

Pretty basic nodes which require no updates, just "git clone" the repo.
